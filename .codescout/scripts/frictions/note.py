"""File one friction in the frictions inbox, with the caller's recent failed calls attached.

Input is either flags or one JSON object on stdin (stdin is read only when `--title` is absent):
    --title "..." --tool grep [--body "..."] [--kind other] [--severity low] [--tag system ...]
    {"title": "...", "tool": "grep", "body": "...", "kind": "other", "severity": "low", "tags": ["system"]}
Other flags: `--no-evidence` (attach nothing), `--minutes 30` and `--rows 5` (the window and the
most rows attached), `--db <path>` (default: the usage database of the main checkout).
`--tag` is repeatable and joins the JSON `tags`; repeats are filed once. A tag is lowercase letters
and digits joined by single hyphens, at most 32 characters. A tag needs no registration.

The entry starts as `inbox` (the readme's `initial_status`). Unless `--no-evidence` is given, the
verb adds an `## Evidence (auto)` section: the failed calls of your root session in the last
`--minutes` minutes, one line each, as `- row <id> · <tool> · <family> · <time> · <message>`.

Output, one item per line: the new entry's key; `evidence: <n> rows from session <id>` or
`evidence: none (<reason>)`; for each tag given, `tags: a, b (known)` and one `new tag: x (...)` line
per tag outside the vocabulary (`tags: ... (vocabulary not found)` when the template has no
`## Known tags`); then `candidates:` and up to three lines `- <path>: <title>` (open bugs
and frictions that look like the same finding), or `candidates: none`. The entry is filed either way.

A refusal prints `NOT DONE — <reason>` and exits 2:
  - the title or the tool is missing, or the kind or the severity is not in its list;
  - a tag has a bad shape, or `tags` is not a list of strings;
  - another absolute path is left in the title or body after the checkout root became `<project>`;
  - a live entry of this collection has the same title (case, spacing and punctuation aside).
The entry is created through `codescout.doc.create`, the one write door; the usage database is
opened read-only and this verb opens no file for writing.
"""
import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import codescout

COLLECTION = "frictions"
ENTRY_KIND = "friction"
KINDS = [
    "wrong-guidance", "misleading-output", "gate-too-strict", "gate-too-loose", "param-confusion",
    "missing-capability", "silent-failure", "discoverability", "hint-ineffective", "latency",
    "other",
]
SEVERITIES = ["low", "med", "high"]
# A tag is lowercase words joined by single hyphens. Core imposes no shape; only `note` does.
TAG_SHAPE = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
MAX_TAG_LEN = 32
# The vocabulary of known tags: a section of the entry template, edited by hand, one bullet per tag.
TEMPLATE_REL = "docs/trackers/frictions/entry-template.md"
KNOWN_TAG_BULLET = re.compile(r"^- `([^`]+)`\s*[—-]\s*(.+)$")
OPEN_BUG_STATUSES = ["open", "taken", "investigating"]
CLOSED_FRICTION_STATUSES = {"fixed-verified", "wontfix", "not-a-friction", "duplicate"}
NOT_ENTRIES = {"readme.md"}
BUGS_BOX_DIR = "docs/trackers/ledgers/bugs/"
MAX_CANDIDATES = 3
WIDTH = 200
REFUSAL = "NOT DONE — "
# The calls of this box's own verbs. A refusal of `note` (a duplicate title) is the box teaching, and
# attached to the next `note` it would be a loop, so these rows are neither evidence nor part of a run.
# `note` also creates its entry through the door, which writes a `call:doc` row that names the
# collection: a create that fails there is the box's own failure, so the second clause leaves it out.
OWN_BOX_ROWS = (
    "NOT (tool_name = 'call:box' AND COALESCE(json_extract(input_json, '$.key'), '') = 'frictions')"
    " AND NOT (tool_name = 'call:doc'"
    " AND COALESCE(json_extract(input_json, '$.collection'), '') = 'frictions')"
)

# A path that belongs to someone's machine: a home or temp directory, or a Windows drive path.
# Neither branch starts right after a word character, a dot or a hyphen: that keeps the `s:/` of
# `https://` and the `/home/x` of `https://example.com/home/x` (a URL path) out, while
# `file:///home/x` and `(/home/x)` still match.
_END = r"""[^\s"'`<>)\]},;]*"""
FOREIGN_PATH = re.compile(
    r"(?<![\w.\-])(?:/(?:home|Users|tmp)/" + _END + r"|[A-Za-z]:[\\/]" + _END + r")"
)
STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "when", "but", "not",
    "are", "was", "does", "did", "has", "have", "its", "than", "then",
}


class Refusal(Exception):
    """The verb refuses to file; the message is the reason."""


def usage_db_path(root):
    """`<root>/.codescout/usage.db`; for a linked worktree, the main checkout's database."""
    root_path = Path(root)
    git = root_path / ".git"
    if git.is_file():
        lines = git.read_text(encoding="utf-8").strip().splitlines()
        match = re.match(r"gitdir:\s*(.+?)/\.git/worktrees/[^/]+/?$", lines[0]) if lines else None
        if match:
            return Path(match.group(1)) / ".codescout" / "usage.db"
    return root_path / ".codescout" / "usage.db"


def root_session(value):
    """The root session id: the part of a session id before `/`, or None when there is none."""
    if not value:
        return None
    return value.split("/", 1)[0].strip() or None


def one_line(text, width=WIDTH):
    """Whitespace runs become one space; the text is cut to `width` characters."""
    return " ".join((text or "").split())[:width]


def tool_label(tool_name, input_json):
    """What names a call in the evidence and in `recent`.

    A `call:box` row names the box and the verb, a `call:py` row the script (both in `input_json`),
    because every verb of every box shares one `tool_name`. Any other row, and a row whose input is
    missing, is not JSON or lacks the keys, keeps its `tool_name`.
    """
    try:
        data = json.loads(input_json) if input_json else None
    except ValueError:
        return tool_name
    if not isinstance(data, dict):
        return tool_name
    if tool_name == "call:box":
        key, verb = data.get("key"), data.get("verb")
        if isinstance(key, str) and isinstance(verb, str):
            return f"call:box {key}/{verb}"
    elif tool_name == "call:py":
        script = data.get("script")
        if isinstance(script, str):
            return f"call:py {script}"
    return tool_name


def failed_rows(conn, session, since, limit):
    """Failed calls since `since` (UTC `YYYY-MM-DD HH:MM:SS`), newest first.

    With `session`, only the rows of that root session and of its subagents (`<session>/<agent>`).
    The rows of this box's own verbs are left out ([`OWN_BOX_ROWS`]). Each row has a `label`
    ([`tool_label`]) beside its `tool_name`.
    """
    sql = (
        "SELECT id, tool_name, err_family, called_at, error_msg, cc_session_id, input_json"
        f" FROM tool_calls WHERE outcome != 'success' AND called_at >= ? AND {OWN_BOX_ROWS}"
    )
    params = [since]
    if session:
        escaped = session.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        sql += " AND (cc_session_id = ? OR cc_session_id LIKE ? ESCAPE '\\')"
        params += [session, escaped + "/%"]
    sql += " ORDER BY id DESC"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    keys = ["id", "tool_name", "err_family", "called_at", "error_msg", "cc_session_id", "input_json"]
    rows = [dict(zip(keys, r)) for r in conn.execute(sql, params)]
    for r in rows:
        r["error_msg"] = one_line(r["error_msg"])
        r["label"] = tool_label(r["tool_name"], r.pop("input_json"))
    return rows


def roots(root):
    """The checkout root as given and as resolved, longest first."""
    given = (root or "").rstrip("/")
    found = {given, os.path.realpath(given).rstrip("/")} if given else set()
    return sorted((r for r in found if r), key=len, reverse=True)


def scrub(text, root, redact=False):
    """The checkout root becomes `<project>`. Another machine path is refused, or with `redact`
    replaced by `<path>` (for text the verb did not write itself, such as an attached error)."""
    for r in roots(root):
        # The root counts only when it ends the name: `<root>.worktrees/x` is another directory.
        text = re.sub(re.escape(r) + r"(?![\w.\-])", "<project>", text)
    leftovers = FOREIGN_PATH.findall(text)
    if leftovers and redact:
        return FOREIGN_PATH.sub("<path>", text)
    if leftovers:
        raise Refusal(
            "another absolute path is left; write it as <project>/... or remove it: "
            + ", ".join(dict.fromkeys(leftovers))
        )
    return text


def evidence_block(rows):
    lines = ["## Evidence (auto)", ""]
    for r in rows:
        lines.append(
            f"- row {r['id']} · {r['label']} · {r['err_family'] or '-'}"
            f" · {r['called_at']} · {r['error_msg']}"
        )
    return "\n".join(lines)


def collect_evidence(args, root):
    """(rows, line for the output). Never raises: no evidence is a reason, not a failure."""
    if args.no_evidence:
        return [], "evidence: none (--no-evidence)"
    session = root_session(os.environ.get("CLAUDE_CODE_SESSION_ID"))
    if not session:
        return [], "evidence: none (no session id)"
    db = Path(args.db) if args.db else usage_db_path(root)
    if not db.is_file():
        return [], f"evidence: none (no usage database at {db})"
    since = (datetime.now(timezone.utc) - timedelta(minutes=args.minutes)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    try:
        conn = sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)
        try:
            rows = failed_rows(conn, session, since, args.rows)
        finally:
            conn.close()
    except sqlite3.Error as e:
        return [], f"evidence: none (the usage database cannot be read: {e})"
    if not rows:
        return [], f"evidence: none (no failed calls in the last {args.minutes} minutes for session {session})"
    return rows, f"evidence: {len(rows)} rows from session {session}"


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal(f"bad arguments: {message}")


def parse(argv):
    p = Parser(prog="codescout box frictions note", add_help=False)
    p.add_argument("--title")
    p.add_argument("--tool")
    p.add_argument("--body")
    p.add_argument("--kind")
    p.add_argument("--severity")
    p.add_argument("--tag", action="append", default=[])
    p.add_argument("--db")
    p.add_argument("--minutes", type=int, default=30)
    p.add_argument("--rows", type=int, default=5)
    p.add_argument("--no-evidence", action="store_true")
    return p.parse_args(argv)


def read_fields(args):
    """The title, tool, body, kind and severity, from flags or from one JSON object on stdin."""
    data = {}
    if args.title is None:
        text = sys.stdin.read()
        if text.strip():
            try:
                data = json.loads(text)
            except ValueError:
                raise Refusal("the input on stdin is not JSON; send one JSON object or use --title")
            if not isinstance(data, dict):
                raise Refusal("the input on stdin must be one JSON object")
    else:
        data = {"title": args.title}
    for name in ("tool", "body", "kind", "severity"):
        given = getattr(args, name)
        if given is not None:
            data[name] = given
    out = {}
    for name in ("title", "tool"):
        value = data.get(name)
        if not isinstance(value, str) or not value.strip():
            raise Refusal(f"`{name}` is missing or empty; it must be a non-empty string")
        out[name] = value.strip()
    body = data.get("body", "")
    if not isinstance(body, str):
        raise Refusal("`body` must be a string")
    out["body"] = body
    out["kind"] = data.get("kind", "other")
    out["severity"] = data.get("severity", "low")
    if out["kind"] not in KINDS:
        raise Refusal(f"`kind` must be one of: {', '.join(KINDS)}")
    if out["severity"] not in SEVERITIES:
        raise Refusal(f"`severity` must be one of: {', '.join(SEVERITIES)}")
    out["tags"] = read_tags(args.tag, data.get("tags", []))
    return out


def read_tags(flagged, given):
    """The tags from the `--tag` flags, then from the JSON `tags` list: each checked, repeats dropped."""
    if not isinstance(given, list) or not all(isinstance(t, str) for t in given):
        raise Refusal("`tags` must be a list of strings")
    tags = list(dict.fromkeys([*flagged, *given]))
    for tag in tags:
        if len(tag) > MAX_TAG_LEN or not TAG_SHAPE.fullmatch(tag):
            raise Refusal(
                f"the tag {tag!r} is not allowed; a tag is lowercase letters and digits [a-z0-9] "
                f"joined by single hyphens, at most {MAX_TAG_LEN} characters"
            )
    return tags


def known_tags(root):
    """The tags of `## Known tags` in the entry template, each with its meaning; None when the
    file or the section is missing. A bullet is ``- `tag` — meaning``; reading stops at the next `## `."""
    try:
        text = (Path(root) / TEMPLATE_REL).read_text(encoding="utf-8")
    except OSError:
        return None
    found, inside, seen = {}, False, False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line[3:].strip().lower() == "known tags"
            seen = seen or inside
            continue
        match = KNOWN_TAG_BULLET.match(line) if inside else None
        if match:
            found[match.group(1)] = match.group(2).strip()
    return found if seen else None


def tag_lines(tags, known):
    """The lines `note` prints about the tags it filed: the known ones in one line, each new one in
    its own line, or one line saying the vocabulary was not found."""
    if not tags:
        return []
    if known is None:
        return [f"tags: {', '.join(tags)} (vocabulary not found)"]
    lines = []
    old = [t for t in tags if t in known]
    if old:
        lines.append(f"tags: {', '.join(old)} (known)")
    for tag in tags:
        if tag not in known:
            lines.append(f"new tag: {tag} (add it to Known tags in {TEMPLATE_REL} if it should stay)")
    return lines


def normalise(title):
    """Lowercase, punctuation removed, whitespace collapsed."""
    return " ".join(re.sub(r"[^\w\s]", "", title.lower()).split())


def words(title):
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) >= 3 and w not in STOPWORDS}


def git_root(start):
    """The nearest folder at or above `start` that holds `.git` (a folder, or the file of a linked
    worktree), as `lookup_git_root` finds it in the core; `start` itself when there is none."""
    start = os.path.realpath(start) if start else start
    cur = start
    while cur:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return start


def file_path(row, root):
    """Where the row's file is: its `abs_path`, else its `rel_path` under the git root of `root`
    (the derived read of an opted-in checkout names a file by `rel_path`, relative to the git root,
    and drops `abs_path`; a project can be a subfolder of its repository); None when it names
    neither."""
    path = row.get("abs_path")
    if isinstance(path, str) and path:
        return path
    rel = row.get("rel_path")
    if isinstance(rel, str) and rel and not row.get("repo"):
        return os.path.join(git_root(root), rel) if root else rel
    return None


def ref_of(row):
    """What names the row in the next `doc` call: its `id`, else its `key` (the derived read drops
    `id` where the key addresses the document)."""
    return row.get("id") or row.get("key")


def relative(row, root):
    """The row's path relative to the checkout; the row id (else key) when the path lies outside it."""
    rel = row.get("rel_path")
    if isinstance(rel, str) and rel and not row.get("abs_path") and not row.get("repo"):
        return rel
    path = row.get("abs_path")
    if isinstance(path, str):
        for r in roots(root):
            if path.startswith(r + "/"):
                return path[len(r) + 1 :]
    return str(ref_of(row) or "?")


def is_entry(row, root):
    path = file_path(row, root)
    name = os.path.basename(path if isinstance(path, str) else relative(row, root))
    return name not in NOT_ENTRIES


def live_entries(root):
    """Entries of this collection that are not archived: `find` hides archived rows by default."""
    prefix = codescout.box.dir().rstrip("/") + "/"
    rows = codescout.doc.find_iter(filter={"rel_path": {"contains": prefix}})
    return [r for r in rows if is_entry(r, root)]


def open_box_bugs():
    """Open bugs of the bugs box, read by its folder: the catalog has no `entry_kind` column.

    `find` hides archived rows by default, so only live entries come back. The status filter is
    the one the legacy bug search uses; it also drops the readme, whose status is `active`.
    """
    rows = codescout.doc.find_iter(filter={"rel_path": {"contains": BUGS_BOX_DIR}})
    return [r for r in rows if r.get("status") in OPEN_BUG_STATUSES]


def candidates(title, entries, root):
    """Open bugs and open frictions sharing words with `title`, best first, at most three."""
    wanted = words(title)
    if not wanted:
        return []
    needed = min(2, len(wanted))
    bugs = codescout.doc.find_iter(kind="bug", filter={"status": {"in": OPEN_BUG_STATUSES}})
    frictions = [r for r in entries if r.get("status") not in CLOSED_FRICTION_STATUSES]
    scored = []
    for row in list(bugs) + open_box_bugs() + frictions:
        row_title = row.get("title")
        if not isinstance(row_title, str):
            continue
        shared = len(wanted & words(row_title))
        if shared >= needed:
            scored.append((-shared, relative(row, root), " ".join(row_title.split())))
    scored.sort()
    unique, seen = [], set()
    for item in scored:
        if item[1] not in seen:
            seen.add(item[1])
            unique.append(item)
    return unique[:MAX_CANDIDATES]


def file_note(argv):
    args = parse(argv)
    root = os.environ.get("CODESCOUT_PROJECT", "")
    fields = read_fields(args)
    title = scrub(fields["title"], root)
    body = scrub(fields["body"], root)

    entries = live_entries(root)
    wanted = normalise(title)
    for row in entries:
        if normalise(str(row.get("title", ""))) == wanted:
            raise Refusal(
                f"a live entry already has this title: {relative(row, root)}; "
                "do not file it again, update that entry instead"
            )
    found = candidates(title, entries, root)

    rows, evidence_line = collect_evidence(args, root)
    if rows:
        block = scrub(evidence_block(rows), root, redact=True)
        body = f"{body}\n\n{block}" if body.strip() else block
    elif not body.strip():
        body = "No detail given."

    extra = {"tool": fields["tool"], "friction_kind": fields["kind"], "severity": fields["severity"]}
    session = root_session(os.environ.get("CLAUDE_CODE_SESSION_ID"))
    if session:
        extra["session"] = session
    result = codescout.doc.create(
        collection=COLLECTION, kind=ENTRY_KIND, title=title, extra=extra, body=body,
        **({"tags": fields["tags"]} if fields["tags"] else {}),
    )
    key = result.get("key") if isinstance(result, dict) else None
    if not key:
        raise Refusal(f"the entry was created but the answer names no key: {result!r}")

    print(key)
    print(evidence_line)
    for line in tag_lines(fields["tags"], known_tags(root)):
        print(line)
    if found:
        print("candidates:")
        for _, path, row_title in found:
            print(f"- {path}: {row_title}")
    else:
        print("candidates: none")


def main(argv=None):
    try:
        file_note(sys.argv[1:] if argv is None else argv)
    except Refusal as e:
        print(f"{REFUSAL}{e}")
        return 2
    except codescout.CodescoutError as e:
        print(f"{REFUSAL}codescout failed: {e}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
