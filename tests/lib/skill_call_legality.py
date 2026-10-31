"""Run the tool calls that skills prescribe against a real codescout and check they are legal.

Bug af3292c4ea2d4712 (option 2). Prints `PASS:` / `FAIL:` / `SKIP:` / `INFO:` lines; exits 1 on any
FAIL. Called by tests/test-skill-call-legality.sh.

What it establishes: the call, as the skill text spells it, is accepted by the server and has the
effect the skill claims. What it does NOT establish: that the skill's prose around the call is
true, or that any call other than the one extracted here is legal. INFO lines record measurements
that are not yet assertions.

The control matters as much as the case. A harness that cannot fail reads as a harness that
passes, so the same call with the one known-bad body (an em-dash tail on `dated`) must be
REFUSED — if it is accepted, the instrument is broken and the PASS above it means nothing.
"""

from __future__ import annotations

import ast
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cs_isolated import IsolatedCodescout, find_binary  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RECON_SKILL = ROOT / "codescout-companion" / "skills" / "reconnaissance" / "SKILL.md"
MARKER = "**ID + append — one call.**"
ANCHOR = "| — | — | — | — | — | (none yet) |"
FAILS = 0
CREATED: list[str] = []  # fixture ledger ids not yet dropped; see make_ledger
# The heading the shipped ledger templates carry for new entries. The fixture holds THIS heading, not
# whatever heading a skill's call names, so a typo in a skill's `anchor_heading` is refused, not adopted.
TEMPLATE_HEADING = "## Template for new entries"
TEMPLATE_FILES = ("tracker-hygiene/references/tracker-hygiene-log-template.md",
                  "reconnaissance/references/reconnaissance-patterns-template.md")

def ok(msg: str) -> None:
    print(f"  PASS: {msg}")


def bad(msg: str, why: str) -> None:
    global FAILS
    FAILS += 1
    print(f"  FAIL: {msg} — {why}")


def info(msg: str) -> None:
    print(f"  INFO: {msg}")


def extract_call(md: str) -> dict:
    """First fenced `doc(...)` block after MARKER, as a kwargs dict. Raises ValueError if absent."""
    at = md.find(MARKER)
    if at < 0:
        raise ValueError(f"marker {MARKER!r} not found")
    m = re.search(r"```python\n(doc\(.*?\))\n```", md[at:], re.DOTALL)
    if not m:
        raise ValueError("no fenced doc(...) block after the marker")
    call = ast.parse(m.group(1), mode="eval").body
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "doc"):
        raise ValueError("block is not a doc(...) call")
    return {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords}


def fill(call: dict, tracker_id: str, anchor: str) -> dict:
    """Replace the two placeholders the skill leaves for the caller. Anything else stays literal."""
    out = dict(call)
    for key, value in (("id", tracker_id), ("index_after_line", anchor)):
        if not str(out.get(key, "")).startswith("<"):
            raise ValueError(f"skill no longer leaves {key!r} as a <placeholder>; update fill()")
        out[key] = value
    return out


def git_repo(path: Path) -> None:
    path.mkdir(parents=True)
    for cmd in (["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]):
        subprocess.run(["git", "-C", str(path), *cmd], check=True)
    (path / "README.md").write_text("# scratch\n")
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)


def case_fixture_ledger(cs: IsolatedCodescout, repo: Path, call: dict) -> None:
    body = ("# Session Log — fixture\n\n## Index\n\n"
            "| ID | Date | Sev | Cat | Status | Title |\n|---|---|---|---|---|---|\n"
            f"{ANCHOR}\n\n## Template for new entries\n\n(entries go above this line)\n")
    made = cs.call("doc", action="create", kind="tracker", status="active", title="Session Log — fixture",
                   rel_path="docs/trackers/fixture-session-log.md", body=body)
    if not made.ok:
        return bad("fixture ledger created", made.error or made.text[:200])
    tid = made.payload["id"]
    declared = cs.call("doc", action="update", id=tid, patch={"extra": {"entry_prefix": "F"}})
    if not declared.ok:
        return bad("fixture declares entry_prefix", declared.error or declared.text[:200])

    # CONTROL FIRST: it must be refused, or nothing below can pass honestly.
    broken = fill(call, tid, ANCHOR)
    broken["body"] = "**Valid:** dated 2026-05-18 — an em-dash tail\n\n**Observed:** x"
    refused = cs.call("doc", **broken)
    if refused.ok or "is not an ISO date" not in refused.error:
        return bad("control (em-dash tail on `dated`) is refused",
                   f"harness cannot detect the archived failure: ok={refused.ok} error={refused.error[:120]!r}")
    ok("control (em-dash tail on `dated`) is refused: harness can detect a rejection")

    reply = cs.call("doc", **fill(call, tid, ANCHOR))
    if not reply.ok:
        return bad("skill's append_entry call is accepted", reply.error or reply.text[:200])
    ok(f"skill's append_entry call is accepted (allocated {reply.payload.get('id')})")

    got = cs.call("doc", action="get", id=tid, full=True)
    text = got.payload.get("body", "")
    eid = reply.payload.get("id", "?")
    if f"## {eid} — " in text and f"| {eid} |" in text:
        ok("the section and the Index row both landed")
    else:
        bad("the section and the Index row both landed", f"body lacks '## {eid} — ' or '| {eid} |'")
    if re.search(r"\*\*Valid:\*\* dated \d{4}-\d{2}-\d{2}\n", text):
        ok("the server stamped `**Valid:** dated <ISO date>`")
    else:
        bad("the server stamped `**Valid:** dated <ISO date>`", "no such line in the written entry")


def case_real_template(cs: IsolatedCodescout, repo: Path, template: Path, call: dict) -> None:
    rel = "docs/trackers/tmpl-session-log.md"
    shutil.copy(template, repo / rel)
    re_ix = cs.call("librarian", action="reindex", scope="project")
    if not re_ix.ok:
        return bad("template copy is catalogued", re_ix.error or re_ix.text[:200])
    found = cs.call("doc", action="find", rel_path="tmpl-session-log")
    items = found.payload.get("items", [])
    if not items:
        return bad("template copy is catalogued", "doc find returned no row after reindex")
    tid = items[0]["id"]
    lines = (repo / rel).read_text().splitlines()
    anchor = next((l for l in lines if l.startswith("| F-<n> |")), None)
    if anchor is None:
        return bad("template has an Index placeholder row to anchor on", "no line starting '| F-<n> |'")

    skill_says = "ships without `entry_prefix`" in RECON_SKILL.read_text()
    declares = lines[:6].count("entry_prefix:") == 1
    if skill_says and declares:
        bad("skill prose agrees with the real template about entry_prefix",
            "the skill says a fresh template ships without `entry_prefix`; the template's frontmatter declares it")
    else:
        ok("skill prose does not contradict the template's declared entry_prefix")
    edit = cs.call("edit_file", path=rel, old_string="# Session Log — Template", new_string="# Session Log — Template X")
    info(f"edit_file on the fresh copy (skill says 'directly editable'): accepted={edit.ok} "
         f"{'' if edit.ok else 'error=' + edit.error[:140]!r}")

    reply = cs.call("doc", **fill(call, tid, anchor))
    if reply.ok:
        ok(f"skill's call is accepted on a fresh copy of the real template (allocated {reply.payload.get('id')})")
    else:
        bad("skill's call is accepted on a fresh copy of the real template", reply.error or reply.text[:200])


SKILLS = ROOT / "codescout-companion" / "skills"
# Skill files whose `doc(...)` exemplars this runner extracts. Order is only for stable output.
EXEMPLAR_FILES = [
    SKILLS / "tracker-hygiene" / "SKILL.md",
    SKILLS / "tracker-hygiene" / "references" / "tracker-hygiene-log-template.md",
    SKILLS / "reconnaissance" / "references" / "reconnaissance-patterns-template.md",
    SKILLS / "reconnaissance" / "references" / "append-entry-anchoring.md",
    SKILLS / "reconnaissance" / "SKILL.md",
]
CALL_RE = re.compile(r'doc\(\s*action\s*=\s*"(append_entry|update)"')
# The skills write some patches as `{body_edits: [...]}`: JS-style bare keys, not Python.
BARE_KEY = re.compile(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)')


def call_end(text: str, open_at: int) -> int:
    """Index just past the `)` that closes the call whose `(` is at text[open_at]. Quotes respected."""
    depth, quote, i = 0, None, open_at
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced doc( call")


def doc_calls(path: Path) -> tuple[list[tuple[int, dict]], list[int]]:
    """Every `doc(action="append_entry"|"update", ...)` in `path`: (line, kwargs) for those that
    parse, and the lines of those that do not (an `id=…` ellipsis, for instance)."""
    text = path.read_text()
    good: list[tuple[int, dict]] = []
    unparsed: list[int] = []
    for m in CALL_RE.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        try:
            src = BARE_KEY.sub(r'\1"\2"\3', text[m.start():call_end(text, m.start() + 3)])
            node = ast.parse(src, mode="eval").body
            good.append((line, {kw.arg: ast.literal_eval(kw.value) for kw in node.keywords}))
        except (SyntaxError, ValueError):
            unparsed.append(line)
    return good, unparsed


def runnable(call: dict) -> str | None:
    """'anchor' for an append_entry placed by heading, 'edit' for an update that writes body_edits,
    None for any call this runner does not execute. A call that also writes an Index row
    (`index_after_line`) is the one `case_fixture_ledger` already runs, with its placeholder filled."""
    if "index_after_line" in call or "index_row" in call:
        return None
    if call.get("action") == "append_entry" and call.get("anchor_heading") and call.get("id_prefix"):
        return "anchor"
    patch = call.get("patch")
    if call.get("action") == "update" and isinstance(patch, dict) and patch.get("body_edits"):
        return "edit"
    return None


def make_ledger(cs: IsolatedCodescout, slug: str, prefix: str, heading: str) -> str | None:
    """A guarded ledger (declares `entry_prefix`, as the real ones do) holding `heading`. Its id, or None.
    The id is also queued in CREATED: a prefix has one owner per repository, so the caller must drop
    each ledger before the next case declares the same prefix."""
    body = f"# Ledger — fixture {slug}\n\n## Entries\n\n{heading}\n\n(entries go above this line)\n"
    made = cs.call("doc", action="create", kind="tracker", status="active", title=f"Ledger — fixture {slug}",
                   rel_path=f"docs/trackers/fixture-{slug}.md", body=body)
    if not made.ok:
        bad(f"fixture ledger {slug} created", made.error or made.text[:200])
        return None
    tid = made.payload["id"]
    CREATED.append(tid)
    declared = cs.call("doc", action="update", id=tid, patch={"extra": {"entry_prefix": prefix}})
    if not declared.ok:
        bad(f"fixture ledger {slug} declares entry_prefix", declared.error or declared.text[:200])
        return None
    return tid


def case_exemplar(cs: IsolatedCodescout, label: str, slug: str, kind: str, call: dict) -> None:
    """Run one prescribed call on a fresh fixture ledger, after a control that must be refused."""
    prefix = call.get("id_prefix") or "HY"
    tid = make_ledger(cs, slug, prefix, TEMPLATE_HEADING)
    if tid is None:
        return
    real = dict(call, id=tid)

    # CONTROL FIRST: the same call aimed at a heading the ledger lacks must be refused and write nothing.
    wrong = dict(real)
    if kind == "anchor":
        wrong["anchor_heading"] = "## Not a heading in this ledger"
    else:
        wrong["patch"] = {**call["patch"], "body_edits": [{**call["patch"]["body_edits"][0],
                                                          "heading": "## Not a heading in this ledger"}]}
    refused = cs.call("doc", **wrong)
    before = cs.call("doc", action="get", id=tid, full=True).payload.get("body", "")
    if refused.ok or "Not a heading in this ledger" in before:
        return bad(f"{label}: control (heading the ledger lacks) is refused and writes nothing",
                   f"harness cannot detect a bad anchor: ok={refused.ok}")

    reply = cs.call("doc", **real)
    if not reply.ok:
        return bad(f"{label}: prescribed call is accepted", reply.error or reply.text[:200])
    text = cs.call("doc", action="get", id=tid, full=True).payload.get("body", "")
    if kind == "anchor":
        eid = reply.payload.get("id", "?")
        want, what = f"## {eid} — {call['title']}", "the server allocated an id and wrote its section"
        landed = eid.startswith(f"{prefix}-") and want in text
    else:
        content = call["patch"]["body_edits"][0]["content"].split("\n")[0]
        want, what = content, "the inserted section landed"
        landed = content in text and text.index(content) < text.index(call["patch"]["body_edits"][0]["heading"])
    if landed:
        ok(f"{label}: accepted; {what}")
    else:
        bad(f"{label}: accepted; {what}", f"body lacks {want!r} in the expected place")


def case_prescribed_exemplars(cs: IsolatedCodescout) -> None:
    """Every other append_entry-by-heading and body_edits exemplar the skills spell out, and a count of
    the `doc(...)` calls found but NOT run, so a gap is a printed number rather than silence."""
    ran = skipped = 0
    for tpl in TEMPLATE_FILES:
        if f"\n{TEMPLATE_HEADING}\n" in (SKILLS / tpl).read_text():
            ok(f"{tpl} carries the heading the fixture ledgers use")
        else:
            bad(f"{tpl} carries the heading the fixture ledgers use", f"no line {TEMPLATE_HEADING!r}")
    unparsed_at: list[str] = []
    for path in EXEMPLAR_FILES:
        good, unparsed = doc_calls(path)
        rel = path.relative_to(SKILLS)
        unparsed_at += [f"{rel}:{n}" for n in unparsed]
        for line, call in good:
            kind = runnable(call)
            if kind is None:
                skipped += 1
                continue
            ran += 1
            case_exemplar(cs, f"{rel}:{line}", f"ex{ran}", kind, call)
            while CREATED:
                dropped = cs.call("doc", action="delete", id=CREATED.pop(), force=True)
                if not dropped.ok:
                    bad(f"{rel}:{line}: fixture ledger dropped", dropped.error or dropped.text[:200])
    info(f"exemplar calls run: {ran}; found but not run (no heading/body_edits shape): {skipped}; "
         f"found but not parseable as a call: {len(unparsed_at)}" + (f" ({', '.join(unparsed_at)})" if unparsed_at else ""))


def main() -> int:
    binary = find_binary()
    if binary is None:
        print("  SKIP: no codescout binary (CODESCOUT_BIN, PATH, ~/.cargo/bin) — skill-call legality NOT checked")
        return 0
    try:
        call = extract_call(RECON_SKILL.read_text())
    except ValueError as exc:
        bad("append_entry call extracted from reconnaissance/SKILL.md", str(exc))
        return 1
    ok("append_entry call extracted from reconnaissance/SKILL.md")

    sandbox = Path(tempfile.mkdtemp(prefix="cs-skill-call-"))
    try:
        repo = sandbox / "repo"
        git_repo(repo)
        (repo / "docs" / "trackers").mkdir(parents=True)
        template = Path(os.environ.get("CODESCOUT_REPO", ROOT.parent / "codescout")) / "docs/templates/session-log.md"
        with IsolatedCodescout(repo, sandbox, binary) as cs:
            case_fixture_ledger(cs, repo, call)
            case_prescribed_exemplars(cs)
            if template.is_file():
                case_real_template(cs, repo, template, call)
            else:
                print(f"  SKIP: real template not found at {template} (set CODESCOUT_REPO) — fresh-copy case NOT run")
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
