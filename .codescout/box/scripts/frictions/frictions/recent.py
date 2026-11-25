"""Show the failed tool calls of this session, or of all sessions, grouped, with the runs and the rows an entry cites.

Read-only: the verb creates and updates nothing, and opens the usage database read-only.

    codescout box frictions recent [--since 'YYYY-MM-DD HH:MM:SS' (UTC; a `T` between date and time
                                    is accepted; default: 60 minutes ago)]
                                   [--all-sessions] [--db <path>]

Output:
  - a header, `failed calls since <since> for session <id>` (or `for all sessions`);
  - one line per tool and error family, most rows first:
    `<count> <tool> <family> rows <ids, newest first, at most 5>`; an id that an entry of this
    collection cites (as `row <id>`) is followed by ` [cited: <entry key>]`;
  - `runs:` then one line per run, `<root session> rows <first id>..<last id> (<n> failures)`.
    A run is two or more failed calls of one root session with no successful call of that session
    between them; a subagent (`<session>/<agent>`) belongs to its root session.
With no failed call it prints `no failed calls in the window since <since> for session <id>`.
A refusal (`NOT DONE — <reason>`, exit 2): no session id and no `--all-sessions`, or no database.
"""
import argparse
import importlib.util
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import codescout

# `python -P` keeps the script's folder off sys.path, so the shared helpers load by path.
_spec = importlib.util.spec_from_file_location(
    "frictions_note", Path(__file__).resolve().with_name("note.py")
)
note = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(note)

Refusal = note.Refusal
REFUSAL = note.REFUSAL
DEFAULT_MINUTES = 60
MAX_IDS = 5
CITED = re.compile(r"\brow (\d+)\b")


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal(f"bad arguments: {message}")


def parse(argv):
    p = Parser(prog="codescout box frictions recent", add_help=False)
    p.add_argument("--since")
    p.add_argument("--all-sessions", action="store_true")
    p.add_argument("--db")
    return p.parse_args(argv)


def window_rows(conn, session, since):
    """Every call since `since` as (id, outcome, cc_session_id), oldest first."""
    sql = (
        "SELECT id, outcome, cc_session_id FROM tool_calls"
        f" WHERE called_at >= ? AND {note.OWN_BOX_ROWS}"
    )
    params = [since]
    if session:
        escaped = session.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        sql += " AND (cc_session_id = ? OR cc_session_id LIKE ? ESCAPE '\\')"
        params += [session, escaped + "/%"]
    return conn.execute(sql + " ORDER BY id", params).fetchall()


def runs_of(rows):
    """S-A runs as (root session, first id, last id, failures), by first id."""
    open_runs, found = {}, []
    for rid, outcome, cc in rows:
        root = note.root_session(cc) or "-"
        if outcome == "success":
            run = open_runs.pop(root, [])
            if len(run) >= 2:
                found.append((root, run[0], run[-1], len(run)))
        else:
            open_runs.setdefault(root, []).append(rid)
    found += [(root, run[0], run[-1], len(run)) for root, run in open_runs.items() if len(run) >= 2]
    return sorted(found, key=lambda r: r[1])


def cited_rows(root):
    """Row id -> the key of the first entry that cites it as `row <id>`."""
    cited = {}
    prefix = codescout.box.dir().rstrip("/") + "/"
    rows = codescout.doc.find_iter(filter={"rel_path": {"contains": prefix}})
    for row in rows:
        path = note.file_path(row, root)
        if not note.is_entry(row, root) or not isinstance(path, str) or not os.path.isfile(path):
            continue
        key = Path(path).stem
        for rid in CITED.findall(Path(path).read_text(encoding="utf-8")):
            cited.setdefault(int(rid), key)
    return cited


def parse_since(text):
    """`--since` as the `YYYY-MM-DD HH:MM:SS` the database compares against (UTC).

    `called_at` is compared as text, so `2026-11-21T08:16:03` (a `T` sorts after a space) would
    put every row of that day outside the window and print a false zero. Accepted: a space or a
    `T` between date and time, an optional trailing `Z`, seconds or not, or a bare date.
    """
    candidate = text.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1]
    for fmt in (
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d"
    ):
        try:
            return datetime.strptime(candidate, fmt).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    raise Refusal(
        f"--since {text!r} is not a UTC time; write it as '2026-11-21 08:16:03' or "
        "'2026-11-21T08:16:03'"
    )



def show(argv):
    args = parse(argv)
    root = os.environ.get("CODESCOUT_PROJECT", "")
    session = None
    if not args.all_sessions:
        session = note.root_session(os.environ.get("CLAUDE_CODE_SESSION_ID"))
        if not session:
            raise Refusal("no session id in this environment; pass --all-sessions")
    db = Path(args.db) if args.db else note.usage_db_path(root)
    if not db.is_file():
        raise Refusal(f"no usage database at {db}")
    since = parse_since(args.since) if args.since else (
        datetime.now(timezone.utc) - timedelta(minutes=DEFAULT_MINUTES)
    ).strftime("%Y-%m-%d %H:%M:%S")
    scope = f"session {session}" if session else "all sessions"
    try:
        conn = sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)
        try:
            failed = note.failed_rows(conn, session, since, None)
            window = window_rows(conn, session, since)
        finally:
            conn.close()
    except sqlite3.Error as e:
        raise Refusal(f"the usage database cannot be read: {e}")
    if not failed:
        print(f"no failed calls in the window since {since} for {scope}")
        return
    cited = cited_rows(root)
    groups = {}
    for r in failed:
        groups.setdefault((r["label"], r["err_family"] or "-"), []).append(r["id"])
    print(f"failed calls since {since} for {scope}")
    for (tool, family), ids in sorted(groups.items(), key=lambda g: (-len(g[1]), g[0])):
        shown = [
            f"{rid} [cited: {cited[rid]}]" if rid in cited else str(rid) for rid in ids[:MAX_IDS]
        ]
        print(f"{len(ids)} {tool} {family} rows {', '.join(shown)}")
    runs = runs_of(window)
    if runs:
        print("runs:")
        for root_id, first, last, count in runs:
            print(f"{root_id} rows {first}..{last} ({count} failures)")


def main(argv=None):
    try:
        show(sys.argv[1:] if argv is None else argv)
    except Refusal as e:
        print(f"{REFUSAL}{e}")
        return 2
    except codescout.CodescoutError as e:
        print(f"{REFUSAL}codescout failed: {e}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
