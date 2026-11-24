"""Tests for the `note` verb of the `frictions` box.

The verb is loaded by path, with a fake `codescout` module in `sys.modules`: no test runs a real
binary or touches the real collection. The `usage.db` of each test is built in `tmp_path` with the
columns of `tool_calls` the verb reads.
"""
import importlib.util
import io
import json
import sqlite3
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

VERB_PATH = Path(__file__).resolve().parent.parent / "note.py"
ROOT = "/home/dev/checkout"
BOX_DIR = "docs/trackers/ledgers/frictions"
BUGS_BOX_DIR = "docs/trackers/ledgers/bugs/"
SESSION = "11111111-aaaa-bbbb-cccc-222222222222"
REFUSAL = "NOT DONE — "


class FakeCodescout(types.ModuleType):
    """A stand-in for the helper module: records every call and answers from queued rows."""

    class CodescoutError(Exception):
        pass

    def __init__(self):
        super().__init__("codescout")
        self.finds = []
        self.creates = []
        self.box_rows = []
        self.bug_rows = []
        self.bugs_box_rows = []
        self.create_result = {"key": "2026-11-21-a-friction", "id": "x", "abs_path": "/x"}
        fake = self

        class Doc:
            def find_iter(self, *, page=200, **filters):
                fake.finds.append(filters)
                if "semantic" in filters or "query" in filters:
                    raise AssertionError("the verb must not ask for a semantic search")
                if filters.get("kind") == "bug":
                    rows = fake.bug_rows
                elif BUGS_BOX_DIR in json.dumps(filters):
                    rows = fake.bugs_box_rows
                elif BOX_DIR in json.dumps(filters):
                    rows = fake.box_rows
                else:
                    raise AssertionError(f"unexpected find: {filters}")
                if not filters.get("include_archived"):
                    rows = [r for r in rows if r.get("status") != "archived"]
                return iter(rows)

            def create(self, **args):
                fake.creates.append(args)
                return fake.create_result

        class Box:
            def key(self):
                return "frictions"

            def dir(self):
                return BOX_DIR

        self.doc = Doc()
        self.box = Box()


@pytest.fixture
def world(monkeypatch):
    fake = FakeCodescout()
    monkeypatch.setitem(sys.modules, "codescout", fake)
    monkeypatch.setenv("CODESCOUT_PROJECT", ROOT)
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", SESSION)
    spec = importlib.util.spec_from_file_location("frictions_note_under_test", VERB_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fake.verb = module
    return fake


def stamp(minutes_ago):
    when = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return when.strftime("%Y-%m-%d %H:%M:%S.") + f"{when.microsecond // 1000:03d}"


def make_db(path, rows):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE tool_calls (id INTEGER PRIMARY KEY, tool_name TEXT, called_at TEXT,"
        " outcome TEXT, error_msg TEXT, err_family TEXT, cc_session_id TEXT, input_json TEXT)"
    )
    for r in rows:
        conn.execute(
            "INSERT INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                r["id"],
                r.get("tool_name", "grep"),
                r.get("called_at", stamp(1)),
                r.get("outcome", "recoverable_error"),
                r.get("error_msg", "boom"),
                r.get("err_family", "some_family"),
                r.get("cc_session_id", SESSION),
                r.get("input_json"),
            ),
        )
    conn.commit()
    conn.close()
    return path


def run(world, monkeypatch, capsys, argv, stdin=""):
    monkeypatch.setattr(sys, "stdin", io.StringIO(stdin))
    code = world.verb.main(argv)
    return code, capsys.readouterr().out


def base_argv(**over):
    argv = {"--title": "Grep hides the regex error", "--tool": "grep", "--no-evidence": None}
    argv.update(over)
    out = []
    for name, value in argv.items():
        if value is False:
            continue
        out.append(name)
        if value is not None:
            out.append(str(value))
    return out


def entry_row(title, name, status="inbox", rid="e"):
    return {
        "id": rid,
        "title": title,
        "status": status,
        "abs_path": f"{ROOT}/{BOX_DIR}/{name}",
    }


def evidence_lines(body):
    return [line for line in body.splitlines() if line.startswith("- row ")]


def test_note_files_an_inbox_entry_with_the_tool_and_session(world, monkeypatch, capsys):
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--body": "It said nothing."}))
    assert code == 0, out
    assert len(world.creates) == 1
    sent = world.creates[0]
    assert sent["collection"] == "frictions"
    assert sent["kind"] == "friction"
    assert sent["title"] == "Grep hides the regex error"
    assert sent["extra"] == {
        "tool": "grep",
        "friction_kind": "other",
        "severity": "low",
        "session": SESSION,
    }
    assert "status" not in sent  # the readme's initial_status says `inbox`
    assert out.splitlines()[0] == "2026-11-21-a-friction"


def test_only_failed_rows_of_the_callers_root_session_are_attached(
    world, monkeypatch, capsys, tmp_path
):
    db = make_db(
        tmp_path / "usage.db",
        [
            {"id": 1, "called_at": stamp(10), "cc_session_id": SESSION},
            {"id": 2, "called_at": stamp(5), "cc_session_id": SESSION + "/agent-1"},
            {"id": 3, "called_at": stamp(4), "cc_session_id": "other-session"},
            {"id": 4, "called_at": stamp(3), "cc_session_id": SESSION, "outcome": "success"},
            {"id": 5, "called_at": stamp(31), "cc_session_id": SESSION},
        ],
    )
    argv = base_argv(**{"--no-evidence": False, "--db": db})
    code, out = run(world, monkeypatch, capsys, argv)
    assert code == 0, out
    lines = evidence_lines(world.creates[0]["body"])
    assert [line.split(" · ")[0] for line in lines] == ["- row 2", "- row 1"]
    assert "evidence: 2 rows from session " + SESSION in out


def test_at_most_five_rows_are_attached(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [{"id": n, "called_at": stamp(20 - n)} for n in range(1, 9)],
    )
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    lines = evidence_lines(world.creates[0]["body"])
    assert [line.split(" · ")[0] for line in lines] == [f"- row {n}" for n in (8, 7, 6, 5, 4)]


def test_no_session_id_still_files_and_says_so(world, monkeypatch, capsys, tmp_path):
    monkeypatch.delenv("CLAUDE_CODE_SESSION_ID")
    db = make_db(tmp_path / "usage.db", [{"id": 1}])
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    assert "evidence: none (no session id)" in out
    assert len(world.creates) == 1
    assert "session" not in world.creates[0]["extra"]
    assert "row 1" not in world.creates[0]["body"]


def test_no_usage_db_still_files_and_says_so(world, monkeypatch, capsys, tmp_path):
    missing = tmp_path / "nowhere" / "usage.db"
    code, out = run(
        world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": missing})
    )
    assert code == 0, out
    assert f"evidence: none (no usage database at {missing})" in out
    assert len(world.creates) == 1


def test_no_evidence_flag_reads_no_database(world, monkeypatch, capsys, tmp_path):
    def boom(*a, **k):
        raise AssertionError("--no-evidence must not open a database")

    monkeypatch.setattr(world.verb.sqlite3, "connect", boom)
    missing = tmp_path / "usage.db"
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--db": missing}))
    assert code == 0, out
    assert "evidence: none (--no-evidence)" in out


def test_a_long_multiline_error_is_one_cut_line(world, monkeypatch, capsys, tmp_path):
    message = "first line\n   second\tline\n" + "x" * 500
    db = make_db(tmp_path / "usage.db", [{"id": 7, "error_msg": message}])
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    lines = evidence_lines(world.creates[0]["body"])
    assert len(lines) == 1
    text = lines[0].split(" · ", 4)[4]
    assert len(text) == 200
    assert text.startswith("first line second line xxx")
    assert "\n" not in text and "\t" not in text


def box_input(key, verb):
    return json.dumps({"key": key, "verb": verb, "args": []})


def evidence_tools(body):
    """The tool field of each evidence line."""
    return [line.split(" · ")[1] for line in evidence_lines(body)]


def test_a_box_verb_failure_is_labelled_with_its_key_and_verb(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [{"id": 1, "tool_name": "call:box", "input_json": box_input("horizon", "add")}],
    )
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    assert evidence_tools(world.creates[0]["body"]) == ["call:box horizon/add"]


def test_a_py_failure_is_labelled_with_its_script(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [{"id": 1, "tool_name": "call:py", "input_json": json.dumps({"script": "x.py", "args": []})}],
    )
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    assert evidence_tools(world.creates[0]["body"]) == ["call:py x.py"]


# A refusal of `note` for a duplicate title is the box teaching, and attached to the next `note` it
# would be a loop; the failures of other boxes are real evidence.
def test_the_frictions_boxs_own_refusals_are_not_evidence(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [
            {"id": 1, "tool_name": "call:box", "input_json": box_input("frictions", "note")},
            {"id": 2, "tool_name": "call:box", "input_json": box_input("horizon", "add")},
            {"id": 3, "tool_name": "call:box", "input_json": box_input("frictions", "promote")},
        ],
    )
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    assert evidence_tools(world.creates[0]["body"]) == ["call:box horizon/add"]
    assert "evidence: 1 rows" in out

# `note` creates its entry through the door, which writes a `call:doc` row naming the collection. A
# create that fails there is the box's own failure, so it is not evidence either; a failed `doc`
# call that names another collection (or none) is.
def test_a_failed_create_into_the_frictions_collection_is_not_evidence(
    world, monkeypatch, capsys, tmp_path
):
    own = json.dumps({"action": "create", "collection": "frictions", "kind": "friction"})
    other = json.dumps({"action": "create", "collection": "bugs", "kind": "bug"})
    no_collection = json.dumps({"action": "find", "scope": "project"})
    db = make_db(
        tmp_path / "usage.db",
        [
            {"id": 1, "tool_name": "call:doc", "input_json": own},
            {"id": 2, "tool_name": "call:doc", "input_json": other},
            {"id": 3, "tool_name": "call:doc", "input_json": no_collection},
            {"id": 4, "tool_name": "call:doc"},
        ],
    )
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    assert evidence_tools(world.creates[0]["body"]) == ["call:doc"] * 3
    assert "evidence: 3 rows" in out


def test_a_row_with_no_input_json_keeps_its_tool_name(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [
            {"id": 1, "tool_name": "call:box"},
            {"id": 2, "tool_name": "call:py", "input_json": "{not json"},
            {"id": 3, "tool_name": "call:box", "input_json": json.dumps({"key": 5})},
        ],
    )
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--no-evidence": False, "--db": db}))
    assert code == 0, out
    assert sorted(evidence_tools(world.creates[0]["body"])) == ["call:box", "call:box", "call:py"]


def test_tool_label_of_invalid_json_is_the_tool_name(world):
    label = world.verb.tool_label
    assert label("grep", box_input("a", "b")) == "grep"
    assert label("call:box", None) == "call:box"
    assert label("call:box", "[]") == "call:box"
    assert label("call:box", box_input("a", "b")) == "call:box a/b"
    assert label("call:py", json.dumps({"script": "s.py"})) == "call:py s.py"



def test_title_body_and_attached_error_text_are_scrubbed(world, monkeypatch, capsys, tmp_path):
    db = make_db(tmp_path / "usage.db", [{"id": 1, "error_msg": f"cannot open {ROOT}/src/a.rs"}])
    argv = base_argv(
        **{
            "--title": f"Tool fails in {ROOT}",
            "--body": f"Did it in {ROOT}/src.",
            "--no-evidence": False,
            "--db": db,
        }
    )
    code, out = run(world, monkeypatch, capsys, argv)
    assert code == 0, out
    sent = world.creates[0]
    assert sent["title"] == "Tool fails in <project>"
    assert "Did it in <project>/src." in sent["body"]
    assert "cannot open <project>/src/a.rs" in sent["body"]
    assert ROOT not in json.dumps(sent)

    world.creates.clear()
    code, out = run(
        world, monkeypatch, capsys, base_argv(**{"--title": "Fails on /home/other/secret/file"})
    )
    assert code == 2
    assert out.startswith(REFUSAL)
    assert world.creates == []


def test_a_body_with_shell_characters_round_trips(world, monkeypatch, capsys):
    body = 'a `b` "c" $HOME $(x)\nline two \'q\' \\n end'
    title = 'Quote " and `tick` and $VAR'
    payload = json.dumps({"title": title, "tool": "run_command", "body": body})
    code, out = run(world, monkeypatch, capsys, ["--no-evidence"], stdin=payload)
    assert code == 0, out
    sent = world.creates[0]
    assert sent["title"] == title
    assert sent["body"] == body
    assert sent["extra"]["tool"] == "run_command"


def test_a_missing_title_or_tool_is_refused_and_nothing_is_created(world, monkeypatch, capsys):
    code, out = run(world, monkeypatch, capsys, ["--tool", "grep", "--no-evidence"], stdin="")
    assert (code, out.startswith(REFUSAL)) == (2, True)
    code, out = run(world, monkeypatch, capsys, ["--title", "A title", "--no-evidence"])
    assert (code, out.startswith(REFUSAL)) == (2, True)
    code, out = run(world, monkeypatch, capsys, ["--no-evidence"], stdin="not json")
    assert (code, out.startswith(REFUSAL)) == (2, True)
    assert world.creates == []


def test_an_unknown_kind_or_severity_is_refused(world, monkeypatch, capsys):
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--kind": "made-up"}))
    assert (code, out.startswith(REFUSAL)) == (2, True)
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--severity": "huge"}))
    assert (code, out.startswith(REFUSAL)) == (2, True)
    assert world.creates == []


def test_a_live_entry_with_the_same_title_is_refused(world, monkeypatch, capsys):
    world.box_rows = [
        entry_row("grep hides the REGEX error!", "2026-11-20-grep.md"),
        {"id": "r", "title": "frictions", "status": "active", "abs_path": f"{ROOT}/{BOX_DIR}/readme.md"},
    ]
    code, out = run(world, monkeypatch, capsys, base_argv())
    assert code == 2
    assert out.startswith(REFUSAL)
    assert "2026-11-20-grep.md" in out
    assert world.creates == []


def test_candidates_include_frictions_and_open_bugs(world, monkeypatch, capsys):
    world.bug_rows = [
        {
            "id": "b1",
            "title": "Grep hides the regex error in the output",
            "status": "open",
            "abs_path": f"{ROOT}/docs/issues/2026-11-01-grep.md",
        }
    ]
    world.box_rows = [
        entry_row("Regex errors of grep are hidden by the hint", "2026-11-02-regex.md"),
        entry_row("Unrelated edit_code retry loop", "2026-11-03-edit.md", rid="e2"),
        {"id": "r", "title": "regex grep error hidden readme", "status": "active",
         "abs_path": f"{ROOT}/{BOX_DIR}/readme.md"},
    ]
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--title": "grep regex error hidden"}))
    assert code == 0, out
    assert "candidates:" in out
    assert f"- docs/issues/2026-11-01-grep.md: Grep hides the regex error in the output" in out
    assert f"- {BOX_DIR}/2026-11-02-regex.md: Regex errors of grep are hidden by the hint" in out
    assert "edit_code retry" not in out
    assert "readme.md" not in out
def test_candidates_include_open_box_bugs(world, monkeypatch, capsys):
    world.bug_rows = [
        {
            "id": "b1",
            "title": "Grep hides the regex error in the output",
            "status": "open",
            "abs_path": f"{ROOT}/docs/issues/2026-11-01-grep.md",
        }
    ]
    world.bugs_box_rows = [
        {
            "id": "b2",
            "title": "Regex errors of grep are hidden by the hint",
            "status": "open",
            "abs_path": f"{ROOT}/{BUGS_BOX_DIR}2026-11-02-regex.md",
        }
    ]
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--title": "grep regex error hidden"}))
    assert code == 0, out
    assert "- docs/issues/2026-11-01-grep.md: Grep hides the regex error in the output" in out
    assert f"- {BUGS_BOX_DIR}2026-11-02-regex.md: Regex errors of grep are hidden by the hint" in out


def test_candidates_leave_out_terminal_box_bugs_and_the_box_readme(world, monkeypatch, capsys):
    title = "Regex errors of grep are hidden by the hint"
    world.bugs_box_rows = [
        {"id": "f", "title": title, "status": "fixed", "abs_path": f"{ROOT}/{BUGS_BOX_DIR}2026-11-02-fixed.md"},
        {"id": "r", "title": title, "status": "active", "abs_path": f"{ROOT}/{BUGS_BOX_DIR}readme.md"},
    ]
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--title": "grep regex error hidden"}))
    assert code == 0, out
    assert "2026-11-02-fixed" not in out
    assert "readme.md" not in out


def test_candidates_over_legacy_bugs_box_bugs_and_frictions_are_capped_at_three(world, monkeypatch, capsys):
    world.bug_rows = [
        {"id": "b1", "title": "Grep hides the regex error in the output", "status": "open",
         "abs_path": f"{ROOT}/docs/issues/2026-11-01-grep.md"},
    ]
    world.bugs_box_rows = [
        {"id": f"x{i}", "title": f"Grep regex error hidden variant {i}", "status": "open",
         "abs_path": f"{ROOT}/{BUGS_BOX_DIR}2026-11-02-v{i}.md"}
        for i in range(2)
    ]
    world.box_rows = [entry_row("Grep regex error hidden in a friction", "2026-11-03-f.md", rid="e1")]
    code, out = run(world, monkeypatch, capsys, base_argv(**{"--title": "grep regex error hidden"}))
    assert code == 0, out
    assert len([l for l in out.splitlines() if l.startswith("- ")]) == 3, out


def test_usage_db_in_a_linked_worktree_is_the_main_checkouts(world, tmp_path):
    verb = world.verb
    worktree = tmp_path / "wt"
    worktree.mkdir()
    (worktree / ".git").write_text("gitdir: /main/repo/.git/worktrees/wt\n")
    assert verb.usage_db_path(str(worktree)) == Path("/main/repo/.codescout/usage.db")

    plain = tmp_path / "plain"
    (plain / ".git").mkdir(parents=True)
    assert verb.usage_db_path(str(plain)) == plain / ".codescout" / "usage.db"

    bare = tmp_path / "bare"
    bare.mkdir()
    assert verb.usage_db_path(str(bare)) == bare / ".codescout" / "usage.db"


def test_the_module_docstring_first_line_is_the_box_description(world):
    first = world.verb.__doc__.splitlines()[0]
    assert first == (
        "File one friction in the frictions inbox, with the caller's recent failed calls attached."
    )


def tagged(*tags):
    argv = base_argv()
    for tag in tags:
        argv.append(f"--tag={tag}")  # the `=` form: argparse reads `--tag -x` as two flags
    return argv


def test_a_tag_flag_reaches_doc_create(world, monkeypatch, capsys):
    code, out = run(world, monkeypatch, capsys, tagged("system", "harness-script"))
    assert code == 0, out
    assert world.creates[-1]["tags"] == ["system", "harness-script"]


def test_tags_in_the_json_input_reach_doc_create(world, monkeypatch, capsys):
    stdin = json.dumps({"title": "A script failed", "tool": "scripts/x.sh", "tags": ["system"]})
    code, out = run(world, monkeypatch, capsys, ["--no-evidence"], stdin=stdin)
    assert code == 0, out
    assert world.creates[-1]["tags"] == ["system"]


def test_a_repeated_tag_is_filed_once(world, monkeypatch, capsys):
    stdin = json.dumps({"title": "A script failed", "tool": "scripts/x.sh", "tags": ["a", "b"]})
    argv = ["--no-evidence", "--tag", "a", "--tag", "a"]
    code, out = run(world, monkeypatch, capsys, argv, stdin=stdin)
    assert code == 0, out
    assert world.creates[-1]["tags"] == ["a", "b"]


def test_no_tag_passes_no_tags_key(world, monkeypatch, capsys):
    code, out = run(world, monkeypatch, capsys, base_argv())
    assert code == 0, out
    assert "tags" not in world.creates[-1]


@pytest.mark.parametrize("bad", ["Env", "python env", "python_env", "-x", "x-", "a" * 33, ""])
def test_a_tag_with_a_bad_shape_is_refused(world, monkeypatch, capsys, bad):
    code, out = run(world, monkeypatch, capsys, tagged(bad))
    assert code == 2, out
    assert out.startswith(REFUSAL), out
    assert "tag" in out and "a-z0-9" in out, out
    assert world.creates == []


def test_tags_must_be_a_list_of_strings(world, monkeypatch, capsys):
    for bad in ("system", ["ok", 3]):
        stdin = json.dumps({"title": "A script failed", "tool": "scripts/x.sh", "tags": bad})
        code, out = run(world, monkeypatch, capsys, ["--no-evidence"], stdin=stdin)
        assert code == 2, out
        assert out.startswith(REFUSAL) and "tags" in out, out
    assert world.creates == []


TEMPLATE_REL = "docs/trackers/frictions/entry-template.md"
VOCABULARY = """# Frictions — entry template and vocabularies

## Vocabularies

- `not-a-tag` — a bullet outside the section is not read

## Known tags

Say what a tag means in one line.

- `system` — anything outside a codescout tool
- `os-package` — a missing OS package

## Template for new entries

- `after-the-section` — not read either
"""


def with_vocabulary(monkeypatch, tmp_path, text=VOCABULARY):
    path = tmp_path / TEMPLATE_REL
    path.parent.mkdir(parents=True)
    path.write_text(text, encoding="utf-8")
    monkeypatch.setenv("CODESCOUT_PROJECT", str(tmp_path))


def test_known_tags_reads_the_bullets_of_the_section(world, monkeypatch, tmp_path):
    with_vocabulary(monkeypatch, tmp_path)
    assert world.verb.known_tags(str(tmp_path)) == {
        "system": "anything outside a codescout tool",
        "os-package": "a missing OS package",
    }


def test_known_tags_is_none_without_the_file_or_the_section(world, monkeypatch, tmp_path):
    assert world.verb.known_tags(str(tmp_path)) is None
    with_vocabulary(monkeypatch, tmp_path, text="# T\n\n## Vocabularies\n\n- `x` — y\n")
    assert world.verb.known_tags(str(tmp_path)) is None


def test_note_prints_the_tags_as_known(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path)
    code, out = run(world, monkeypatch, capsys, tagged("system", "os-package"))
    assert code == 0, out
    assert "tags: system, os-package (known)" in out.splitlines()


def test_note_names_a_new_tag_and_still_files(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path)
    code, out = run(world, monkeypatch, capsys, tagged("system", "brand-new"))
    assert code == 0, out
    lines = out.splitlines()
    assert "tags: system (known)" in lines
    assert (
        "new tag: brand-new (add it to Known tags in "
        "docs/trackers/frictions/entry-template.md if it should stay)"
    ) in lines
    assert world.creates[-1]["tags"] == ["system", "brand-new"]


def test_note_says_when_the_vocabulary_is_missing(world, monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("CODESCOUT_PROJECT", str(tmp_path))
    code, out = run(world, monkeypatch, capsys, tagged("system"))
    assert code == 0, out
    assert "tags: system (vocabulary not found)" in out.splitlines()


def test_note_without_tags_prints_no_tag_line(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path)
    code, out = run(world, monkeypatch, capsys, base_argv())
    assert code == 0, out
    assert not [line for line in out.splitlines() if line.startswith(("tags:", "new tag:"))]


def test_the_tag_lines_come_before_the_candidates(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path)
    code, out = run(world, monkeypatch, capsys, tagged("system"))
    lines = out.splitlines()
    assert lines[0] == "2026-11-21-a-friction"
    assert lines[1].startswith("evidence:")
    assert lines[2] == "tags: system (known)"
    assert lines[3].startswith("candidates:")


def test_a_row_named_by_rel_path_is_found_under_the_git_root_of_a_subfolder_project(world, tmp_path):
    # On an opted-in checkout `find` names a file by its git-root-relative `rel_path`, with no
    # `abs_path` (E4c-2); a project can be a subfolder of its repository, so the file is under the
    # git root, not under the project. A row with `abs_path` keeps it.
    (tmp_path / ".git").mkdir()
    project = tmp_path / "sub"
    project.mkdir()
    row = {"key": "a", "rel_path": "docs/a.md"}
    assert world.verb.file_path(row, str(project)) == str(tmp_path.resolve() / "docs" / "a.md")
    assert world.verb.file_path({"abs_path": "/x/a.md", "rel_path": "a.md"}, str(project)) == "/x/a.md"
    assert world.verb.file_path({"key": "a"}, str(project)) is None
