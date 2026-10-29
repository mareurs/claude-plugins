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
    info(f"skill prose says a fresh template ships without entry_prefix: {skill_says}; "
         f"the template's own frontmatter declares it: {declares}")
    edit = cs.call("edit_file", path=rel, old_string="# Session Log — Template", new_string="# Session Log — Template X")
    info(f"edit_file on the fresh copy (skill says 'directly editable'): accepted={edit.ok} "
         f"{'' if edit.ok else 'error=' + edit.error[:140]!r}")

    reply = cs.call("doc", **fill(call, tid, anchor))
    if reply.ok:
        ok(f"skill's call is accepted on a fresh copy of the real template (allocated {reply.payload.get('id')})")
    else:
        bad("skill's call is accepted on a fresh copy of the real template", reply.error or reply.text[:200])


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
            if template.is_file():
                case_real_template(cs, repo, template, call)
            else:
                print(f"  SKIP: real template not found at {template} (set CODESCOUT_REPO) — fresh-copy case NOT run")
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
