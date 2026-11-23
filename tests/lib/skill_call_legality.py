"""Run the tool calls that skills prescribe against a real codescout and check they are legal.

Bug af3292c4ea2d4712 (option 2). Prints `PASS:` / `FAIL:` / `SKIP:` / `INFO:` lines; exits 1 on any
FAIL. Called by tests/test-skill-call-legality.sh.

What it establishes: the call, as the skill text spells it, is accepted by the server and has the
effect the skill claims. What it does NOT establish: that the skill's prose around the call is
true, that incomplete illustrations can run unchanged, or that index build completes embedding.
INFO lines distinguish incomplete examples and inventory counts from runtime assertions.

The control matters as much as the case. A harness that cannot fail reads as a harness that
passes, so each runtime case first runs the same call with one known-bad part (a heading the ledger
lacks, an unknown event kind) and it must be REFUSED — if it is accepted, the instrument is broken
and the PASS below it means nothing.

Shell lines are not `doc(...)` calls. The `codescout box ...` command lines of the reconnaissance
skill are counted and reported as INFO (case_recon_box_lines); nothing here runs them.
"""

from __future__ import annotations

import ast
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cs_isolated import IsolatedCodescout, find_binary  # noqa: E402
from skill_contract_calls import run_catalog_examples  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RECON_SKILL = ROOT / "codescout-companion" / "skills" / "reconnaissance" / "SKILL.md"
RECON_BOX_FILES = [RECON_SKILL, RECON_SKILL.parent / "references" / "worked-examples.md"]
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


def git_repo(path: Path) -> None:
    path.mkdir(parents=True)
    for cmd in (["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]):
        subprocess.run(["git", "-C", str(path), *cmd], check=True)
    (path / "README.md").write_text("# scratch\n")
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)


SKILLS = ROOT / "codescout-companion" / "skills"
# Skill files whose `doc(...)` exemplars this runner extracts. Order is only for stable output.
EXEMPLAR_FILES = [
    SKILLS / "tracker-hygiene" / "SKILL.md",
    SKILLS / "tracker-hygiene" / "references" / "tracker-hygiene-log-template.md",
    SKILLS / "reconnaissance" / "references" / "reconnaissance-patterns-template.md",
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


def case_prescribed_exemplars(cs: IsolatedCodescout) -> list[tuple[Path, dict]]:
    """Every other append_entry-by-heading and body_edits exemplar the skills spell out, and a count of
    the `doc(...)` calls found but NOT run, so a gap is a printed number rather than silence."""
    ran = skipped = 0
    covered = []
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
            covered.append((path, call))
            while CREATED:
                dropped = cs.call("doc", action="delete", id=CREATED.pop(), force=True)
                if not dropped.ok:
                    bad(f"{rel}:{line}: fixture ledger dropped", dropped.error or dropped.text[:200])
    info(f"exemplar calls run: {ran}; found but not run (no heading/body_edits shape): {skipped}; "
         f"found but not parseable as a call: {len(unparsed_at)}" + (f" ({', '.join(unparsed_at)})" if unparsed_at else ""))
    return covered


BOX_LINE_RE = re.compile(r"^\s*codescout box\b", re.MULTILINE)


def case_recon_box_lines() -> None:
    """The reconnaissance skill teaches `codescout box ...` shell lines, which the doc/tool call
    extractors do not see. Say so in the output, with the count, rather than by silence."""
    counts = {f.name: len(BOX_LINE_RE.findall(f.read_text())) for f in RECON_BOX_FILES}
    info("reconnaissance box command lines (shell, not doc(...) calls; signature and runtime NOT checked here): "
         + ", ".join(f"{name}: {n}" for name, n in counts.items()))


SPEC_DRIFT_SKILL = SKILLS / "spec-drift" / "SKILL.md"


def case_spec_drift(cs: IsolatedCodescout) -> None:
    """spec-drift's own `event_create` call, with the id filled, is accepted on a `kind: spec` artifact
    and reads back; the same call with event kind "verdikt" is refused."""
    label = "spec-drift/SKILL.md event_create"
    text = SPEC_DRIFT_SKILL.read_text()
    m = re.search(r'doc\(\s*action\s*=\s*"event_create"', text)
    if not m:
        return bad(f"{label} call extracted", 'no doc(action="event_create" ...) in the skill')
    try:
        node = ast.parse(text[m.start():call_end(text, m.start() + 3)], mode="eval").body
        call = {kw.arg: ast.literal_eval(kw.value) for kw in node.keywords}
    except (SyntaxError, ValueError) as exc:
        return bad(f"{label} call extracted", f"not parseable as a call: {exc}")
    if not str(call.get("id", "")).startswith("<"):
        return bad(f"{label} call extracted", "skill no longer leaves `id` as a <placeholder>; update case_spec_drift")
    ok(f"{label} call extracted")

    made = cs.call("doc", action="create", kind="spec", status="active", title="Fixture spec",
                   rel_path="docs/superpowers/specs/2026-11-05-fixture-design.md",
                   body="# Fixture design\n\n## Acceptance criteria\n\n- Exports a CSV\n")
    if not made.ok:
        return bad("fixture kind=spec artifact created", made.error or made.text[:200])
    sid = made.payload["id"]
    CREATED.append(sid)

    # CONTROL FIRST: an unknown event kind must be refused, or the PASS below proves nothing.
    wrong = dict(call, id=sid, event={**call["event"], "kind": "verdikt"})
    refused = cs.call("doc", **wrong)
    if refused.ok:
        return bad(f'{label}: control (event kind "verdikt") is refused',
                   "harness cannot detect a bad event kind: the call was accepted")
    ok(f'{label}: control (event kind "verdikt") is refused')

    reply = cs.call("doc", **dict(call, id=sid))
    if not reply.ok:
        return bad(f"{label}: prescribed call is accepted", reply.error or reply.text[:200])
    ok(f"{label}: prescribed call is accepted")

    payload = call["event"]["payload"]
    want, gate = payload["outcome"], payload.get("gate")
    # The example must obey the rule the skill states: gate go <=> no missing/divergent; outcome follows gate.
    clean = payload["missing"] == 0 and payload["divergent"] == 0
    expect_gate = "go" if clean else "no-go"
    expect_outcome = "confirmed" if clean else ("partial" if payload["implemented"] > 0 else "refuted")
    if gate == expect_gate and want == expect_outcome and \
            payload["implemented"] + payload["missing"] + payload["divergent"] == len(payload["criteria"]):
        ok(f"{label}: example payload obeys the rule (gate={gate}, outcome={want})")
    else:
        bad(f"{label}: example payload obeys the gate/outcome rule",
            f"gate={gate!r} want {expect_gate!r}; outcome={want!r} want {expect_outcome!r}; counts vs criteria")
    listed = cs.call("doc", action="event_list", id=sid, kinds=["verdict"])
    got_outcome = listed.ok and re.search(r'"outcome":\s*"%s"' % re.escape(want), listed.text)
    got_gate = listed.ok and gate is not None and re.search(r'"gate":\s*"%s"' % re.escape(gate), listed.text)
    if got_outcome and got_gate:
        ok(f'{label}: event_list(kinds=["verdict"]) returns the recorded outcome and gate')
    else:
        bad(f"{label}: event_list returns the recorded outcome and gate",
            f"outcome found={bool(got_outcome)} gate found={bool(got_gate)}: {listed.error or listed.text[:200]}")
    while CREATED:
        dropped = cs.call("doc", action="delete", id=CREATED.pop(), force=True)
        if not dropped.ok:
            bad(f"{label}: fixture spec dropped", dropped.error or dropped.text[:200])
def case_spec_drift_finds(cs: IsolatedCodescout) -> None:
    """Every `doc(action="find", ...)` spec-drift spells out is accepted (final review M1: a filter on
    the frontmatter key `feature` is refused, because only catalog fields are filterable), and the
    slug route reaches the spec: a `kind="spec"` find returns the fixture, and its `get` carries the
    `feature:` value the skill tells the agent to match by hand."""
    label = "spec-drift/SKILL.md find"
    text = SPEC_DRIFT_SKILL.read_text()
    calls: list[tuple[str, dict]] = []
    for m in re.finditer(r'doc\(\s*action\s*=\s*"find"', text):
        where = f"{label}:{text.count(chr(10), 0, m.start()) + 1}"
        try:
            node = ast.parse(text[m.start():call_end(text, m.start() + 3)], mode="eval").body
            calls.append((where, {kw.arg: ast.literal_eval(kw.value) for kw in node.keywords}))
        except (SyntaxError, ValueError) as exc:
            bad(f"{where}: find call parses", str(exc))
    if not calls:
        return bad(f"{label} calls extracted", 'no doc(action="find" ...) in the skill')
    ok(f"{label}: {len(calls)} calls extracted")

    made = cs.call("doc", action="create", kind="spec", status="draft", tags=["sdd"], title="Fixture spec",
                   rel_path="docs/superpowers/specs/2026-11-05-drift-fixture-design.md",
                   extra={"feature": "fx-slug"},
                   body="# Fixture design\n\n## Acceptance criteria\n\n- Exports a CSV\n")
    if not made.ok:
        return bad("spec-drift fixture spec created", made.error or made.text[:200])
    sid = made.payload["id"]
    CREATED.append(sid)

    # CONTROL FIRST: the filter the skill used to prescribe must be refused, or the PASSes prove nothing.
    refused = cs.call("doc", action="find", kind="spec", filter={"feature": {"eq": "fx-slug"}})
    if refused.ok:
        bad(f"{label}: control (filter on frontmatter key 'feature') is refused",
            "harness cannot detect a non-catalog filter field: the call was accepted")
    else:
        ok(f"{label}: control (filter on frontmatter key 'feature') is refused")

    for where, call in calls:
        reply = cs.call("doc", **call)
        if not reply.ok:
            bad(f"{where}: find call is accepted", reply.error or reply.text[:200])
            continue
        ok(f"{where}: find call is accepted")
        if set(call) <= {"action", "kind", "filter"} and call.get("kind") == "spec":
            if sid in reply.text:
                ok(f"{where}: returns the fixture spec")
            else:
                bad(f"{where}: returns the fixture spec", reply.text[:200])
    got = cs.call("doc", action="get", id=sid)
    # the slug is not in the path or title, so a hit here is the frontmatter value
    if got.ok and "fx-slug" in got.text and '"extra"' in got.text:
        ok(f"{label}: get on the spec shows its feature: value to match by hand")
    else:
        bad(f"{label}: get on the spec shows its feature: value", got.error or got.text[:200])
    while CREATED:
        dropped = cs.call("doc", action="delete", id=CREATED.pop(), force=True)
        if not dropped.ok:
            bad(f"{label}: fixture spec dropped", dropped.error or dropped.text[:200])



SDD_FILES = sorted([*(ROOT / "sdd" / "commands").glob("*.md"), *(ROOT / "sdd" / "skills").rglob("*.md")])
SDD_ACTIONS = ("find", "get", "create", "event_create", "event_list")
SDD_CALL_RE = re.compile(r'doc\(\s*action\s*=\s*"(%s)"' % "|".join(SDD_ACTIONS))


def case_sdd_calls(cs: IsolatedCodescout) -> None:
    """Every doc(...) call that sdd's commands and skill spell out is accepted, with the <placeholder>
    ids filled, and does what the text says: the constitution create lands and is found by its tag, its
    entries are readable through entry_filter, a note and a verdict event read back through event_list."""
    calls: list[tuple[str, dict]] = []
    for path in SDD_FILES:
        text = path.read_text()
        for m in SDD_CALL_RE.finditer(text):
            label = f"{path.relative_to(ROOT)}:{text.count(chr(10), 0, m.start()) + 1}"
            try:
                node = ast.parse(text[m.start():call_end(text, m.start() + 3)], mode="eval").body
                calls.append((label, {kw.arg: ast.literal_eval(kw.value) for kw in node.keywords}))
            except (SyntaxError, ValueError) as exc:
                bad(f"{label}: doc call parses", str(exc))
    if not calls:
        return bad("sdd content prescribes doc calls", "found none under sdd/commands and sdd/skills")
    ok(f"sdd content prescribes {len(calls)} doc calls")

    spec = cs.call("doc", action="create", kind="spec", status="active", tags=["sdd"], title="Fixture spec",
                   rel_path="docs/superpowers/specs/2026-11-05-sdd-fixture-design.md",
                   body="# Fixture design\n\n## Acceptance criteria\n\n- Exports a CSV\n")
    if not spec.ok:
        return bad("sdd fixture spec created", spec.error or spec.text[:200])
    ids = {"<spec id>": spec.payload["id"]}
    made = [spec.payload["id"]]
    verdict = cs.call("doc", action="event_create", id=ids["<spec id>"],
                      event={"kind": "verdict", "payload": {"outcome": "refuted", "gate": "no-go"}})
    if not verdict.ok:
        return bad("sdd fixture verdict recorded", verdict.error or verdict.text[:200])
    # A second, NEWER verdict with the opposite gate: the content says "take the newest verdict"
    # because event_list returns newest first, so the first gate listed must be this one.
    newer = cs.call("doc", action="event_create", id=ids["<spec id>"],
                    event={"kind": "verdict", "payload": {"outcome": "confirmed", "gate": "go"}})
    if not newer.ok:
        return bad("sdd fixture newer verdict recorded", newer.error or newer.text[:200])

    # CONTROL FIRST: an unknown action must be refused, or the PASSes below prove nothing.
    refused = cs.call("doc", action="fnd", kind="spec")
    if refused.ok:
        return bad("sdd calls: control (action 'fnd') is refused", "harness cannot detect a bad call")
    ok("sdd calls: control (action 'fnd') is refused")

    def check(hit: bool, label: str, text: str) -> None:
        ok(label) if hit else bad(label, text[:200])

    # create first: it makes <constitution id>
    for label, call in sorted(calls, key=lambda c: c[1]["action"] != "create"):
        call = dict(call)
        placeholder = str(call.get("id", ""))
        if placeholder.startswith("<"):
            if placeholder not in ids:
                bad(f"{label}: placeholder {placeholder} is known", "update case_sdd_calls")
                continue
            call["id"] = ids[placeholder]
        reply = cs.call("doc", **call)
        if not reply.ok:
            bad(f"{label}: {call['action']} call is accepted", reply.error or reply.text[:200])
            continue
        ok(f"{label}: {call['action']} call is accepted")
        act = call["action"]
        if act == "create":
            ids["<constitution id>"] = reply.payload["id"]
            made.append(reply.payload["id"])
        elif act == "find" and call.get("filter", {}).get("tags", {}).get("contains") == "constitution":
            check(ids.get("<constitution id>", "?") in reply.text,
                  f"{label}: find by tag constitution returns the created tracker", reply.text)
        elif act == "find" and call.get("kind") == "spec":
            check(ids["<spec id>"] in reply.text, f"{label}: find by tag sdd returns the fixture spec", reply.text)
        elif act == "get" and "entry_filter" in call:
            check('"C-1"' in reply.text, f"{label}: entry_filter returns the rule rows", reply.text)
        elif act == "event_list":
            gates = re.findall(r'"gate":\s*"(go|no-go)"', reply.text)
            check(gates[:2] == ["go", "no-go"],
                  f"{label}: event_list lists the newer verdict (payload.gate go) before the older (no-go)",
                  f"gates in order: {gates}: {reply.text}")
        elif act == "event_create":
            listed = cs.call("doc", action="event_list", id=ids["<spec id>"], kinds=["note"])
            check(listed.ok and call["event"]["payload"]["text"] in listed.text,
                  f"{label}: the note reads back through event_list", listed.text)
    for doc_id in made:
        dropped = cs.call("doc", action="delete", id=doc_id, force=True)
        if not dropped.ok:
            bad(f"sdd fixture {doc_id} dropped", dropped.error or dropped.text[:200])


def main() -> int:
    binary = find_binary()
    if binary is None:
        print("  SKIP: no codescout binary (CODESCOUT_BIN, PATH, ~/.cargo/bin) — skill-call legality NOT checked")
        return 0
    case_recon_box_lines()

    sandbox = Path(tempfile.mkdtemp(prefix="cs-skill-call-"))
    try:
        repo = sandbox / "repo"
        git_repo(repo)
        (repo / "docs" / "trackers").mkdir(parents=True)
        with IsolatedCodescout(repo, sandbox, binary) as cs:
            covered = case_prescribed_exemplars(cs)
            case_spec_drift(cs)
            case_spec_drift_finds(cs)
            case_sdd_calls(cs)
            run_catalog_examples(cs, SKILLS, ok, bad, info, covered)
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
