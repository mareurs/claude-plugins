"""Tests for the `recent` verb of the `frictions` box.

The verb is loaded by path, with a fake `codescout` module in `sys.modules` and a `usage.db` built
in `tmp_path`. The fake refuses every write: `recent` only reads.
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

SCRIPTS = Path(__file__).resolve().parent.parent
VERB_PATH = SCRIPTS / "recent.py"
ROOT = "/home/dev/checkout"
BOX_DIR = "docs/boxes/frictions/frictions"
SESSION = "11111111-aaaa-bbbb-cccc-222222222222"
OTHER = "99999999-zzzz-yyyy-xxxx-000000000000"
REFUSAL = "NOT DONE — "


class FakeCodescout(types.ModuleType):
    class CodescoutError(Exception):
        pass

    def __init__(self):
        super().__init__("codescout")
        self.box_rows = []
        self.writes = []
        fake = self

        class Doc:
            def find_iter(self, *, page=200, **filters):
                if BOX_DIR not in json.dumps(filters):
                    raise AssertionError(f"unexpected find: {filters}")
                return iter(fake.box_rows)

            def create(self, **args):
                fake.writes.append(("create", args))
                raise AssertionError("recent must not create anything")

            def update(self, **args):
                fake.writes.append(("update", args))
                raise AssertionError("recent must not update anything")

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
    spec = importlib.util.spec_from_file_location("frictions_recent_under_test", VERB_PATH)
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
                r.get("err_family", "fam_a"),
                r.get("cc_session_id", SESSION),
                r.get("input_json"),
            ),
        )
    conn.commit()
    conn.close()
    return path


def ok(id, **over):
    return {"id": id, "outcome": "success", "err_family": None, "error_msg": None, **over}


def run(world, monkeypatch, capsys, argv):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    code = world.verb.main(argv)
    return code, capsys.readouterr().out


def test_recent_groups_failed_rows_by_tool_and_family(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [
            {"id": 1}, {"id": 2}, {"id": 3},
            {"id": 4, "tool_name": "run_command", "err_family": "fam_b"},
            ok(5),
        ],
    )
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert code == 0, out
    lines = out.splitlines()
    assert lines[0].startswith("failed calls since ")
    assert lines[0].endswith(f" for session {SESSION}")
    assert "3 grep fam_a rows 3, 2, 1" in lines
    assert "1 run_command fam_b rows 4" in lines
    assert lines.index("3 grep fam_a rows 3, 2, 1") < lines.index("1 run_command fam_b rows 4")


def test_recent_groups_box_rows_by_verb(world, monkeypatch, capsys, tmp_path):
    def box(key, verb):
        return json.dumps({"key": key, "verb": verb, "args": []})

    db = make_db(
        tmp_path / "usage.db",
        [
            {"id": 1, "tool_name": "call:box", "input_json": box("horizon", "add")},
            {"id": 2, "tool_name": "call:box", "input_json": box("horizon", "add")},
            {"id": 3, "tool_name": "call:box", "input_json": box("horizon", "now")},
            {"id": 4, "tool_name": "call:box", "input_json": box("frictions", "note")},
        ],
    )
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert code == 0, out
    lines = out.splitlines()
    assert "2 call:box horizon/add fam_a rows 2, 1" in lines
    assert "1 call:box horizon/now fam_a rows 3" in lines
    assert "frictions/note" not in out, "the frictions box's own refusals are not listed"
    assert "rows 1..3 (3 failures)" in out, "nor do they join a run of failures"



def test_an_s_a_run_is_two_or_more_failures_with_no_success_between(
    world, monkeypatch, capsys, tmp_path
):
    db = make_db(
        tmp_path / "usage.db",
        [{"id": 1}, {"id": 2}, ok(3), {"id": 4}, {"id": 5}, {"id": 6}, ok(7), {"id": 8}],
    )
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert code == 0, out
    assert "runs:" in out
    assert f"{SESSION} rows 1..2 (2 failures)" in out
    assert f"{SESSION} rows 4..6 (3 failures)" in out
    assert "8..8" not in out and "rows 8" not in out.split("runs:")[1]


def test_runs_group_by_root_session_so_a_door_row_joins_its_session(
    world, monkeypatch, capsys, tmp_path
):
    db = make_db(
        tmp_path / "usage.db",
        [
            {"id": 1, "tool_name": "call:doc", "cc_session_id": SESSION},
            ok(2, cc_session_id=OTHER),
            {"id": 3, "cc_session_id": SESSION + "/agent-1"},
        ],
    )
    code, out = run(world, monkeypatch, capsys, ["--db", str(db), "--all-sessions"])
    assert code == 0, out
    assert f"{SESSION} rows 1..3 (2 failures)" in out


def test_a_row_cited_by_an_entry_is_marked(world, monkeypatch, capsys, tmp_path):
    entry = tmp_path / "2026-11-20-an-entry.md"
    entry.write_text("---\nkind: entry\n---\n\n## Evidence (auto)\n\n- row 2 · grep · fam_a · t · m\n")
    world.box_rows = [
        {"id": "e", "title": "An entry", "status": "inbox", "abs_path": str(entry)},
        {"id": "gone", "title": "Stale row", "status": "inbox", "abs_path": str(tmp_path / "no.md")},
    ]
    db = make_db(tmp_path / "usage.db", [{"id": 1}, {"id": 2}, {"id": 3}])
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert code == 0, out
    assert "3 grep fam_a rows 3, 2 [cited: 2026-11-20-an-entry], 1" in out


def test_all_sessions_widens_past_the_callers_session(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [{"id": 1}, {"id": 2, "cc_session_id": OTHER, "tool_name": "edit_file"}],
    )
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert "edit_file" not in out
    code, out = run(world, monkeypatch, capsys, ["--db", str(db), "--all-sessions"])
    assert code == 0, out
    assert out.splitlines()[0].endswith(" for all sessions")
    assert "1 edit_file fam_a rows 2" in out


def test_no_failures_says_so(world, monkeypatch, capsys, tmp_path):
    db = make_db(tmp_path / "usage.db", [ok(1), {"id": 2, "cc_session_id": OTHER}])
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert code == 0, out
    assert out.startswith("no failed calls in the window since 20")
    assert out.strip().endswith(f" for session {SESSION}")
    assert len(out.strip().splitlines()) == 1


def test_recent_creates_nothing(world, monkeypatch, capsys, tmp_path):
    db = make_db(tmp_path / "usage.db", [{"id": 1}, {"id": 2}])
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert code == 0, out
    assert world.writes == []


def test_since_limits_the_window(world, monkeypatch, capsys, tmp_path):
    db = make_db(
        tmp_path / "usage.db",
        [{"id": 1, "called_at": stamp(120)}, {"id": 2, "called_at": stamp(5)}],
    )
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert "rows 2" in out and "rows 1" not in out and "1, " not in out
    since = (datetime.now(timezone.utc) - timedelta(minutes=180)).strftime("%Y-%m-%d %H:%M:%S")
    code, out = run(world, monkeypatch, capsys, ["--db", str(db), "--since", since])
    assert "2 grep fam_a rows 2, 1" in out


# `called_at` is compared as text, so a `T` between date and time (it sorts after a space) once put
# every row of the day outside the window and printed a false zero.
def test_since_in_iso_form_is_the_same_window_as_with_a_space(world, monkeypatch, capsys, tmp_path):
    db = make_db(tmp_path / "usage.db", [{"id": 1, "called_at": stamp(5)}])
    since = (datetime.now(timezone.utc) - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")
    code, out = run(world, monkeypatch, capsys, ["--db", str(db), "--since", since])
    assert code == 0, out
    assert "1 grep fam_a rows 1" in out
    assert "since " + since.replace("T", " ") in out.splitlines()[0]


def test_a_since_that_is_not_a_time_is_refused(world, monkeypatch, capsys, tmp_path):
    db = make_db(tmp_path / "usage.db", [{"id": 1}])
    for bad in ("yesterday", "2026-13-45 99:00:00", "08:16"):
        code, out = run(world, monkeypatch, capsys, ["--db", str(db), "--since", bad])
        assert (code, out.startswith(REFUSAL)) == (2, True), bad
        assert "--since" in out


def test_no_session_id_or_no_database_is_a_refusal(world, monkeypatch, capsys, tmp_path):
    db = make_db(tmp_path / "usage.db", [{"id": 1}])
    monkeypatch.delenv("CLAUDE_CODE_SESSION_ID")
    code, out = run(world, monkeypatch, capsys, ["--db", str(db)])
    assert (code, out.startswith(REFUSAL)) == (2, True)
    code, out = run(world, monkeypatch, capsys, ["--db", str(db), "--all-sessions"])
    assert code == 0, out
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", SESSION)
    code, out = run(world, monkeypatch, capsys, ["--db", str(tmp_path / "missing.db")])
    assert (code, out.startswith(REFUSAL)) == (2, True)


def test_the_module_docstring_first_line_is_the_box_description(world):
    first = world.verb.__doc__.splitlines()[0]
    assert first == (
        "Show the failed tool calls of this session, or of all sessions, grouped, with the runs"
        " and the rows an entry cites."
    )
