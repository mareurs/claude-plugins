"""Tests for the `admit` verb of the `frictions` box.

The verb is loaded by path, with a fake `codescout` module in `sys.modules`. The fake keeps the
entries of the collection in a dict, applies each `update` to it, and can run a hook after an
update, so a number taken by another session between the read and the write can be simulated.
"""
import importlib.util
import io
import json
import sys
import types
from pathlib import Path

import pytest

VERB_PATH = Path(__file__).resolve().parent.parent / "admit.py"
ROOT = "/home/dev/checkout"
BOX_DIR = "docs/trackers/ledgers/frictions"
REFUSAL = "NOT DONE — "

GOOD_BODY = """**Observed:** the tool said nothing.

**Query:** `SELECT 1`

**Window:** 2026-11-01 to 2026-11-20 UTC

**Corpus:** 120 rows

**Recovery sample:**

- row 1: fixed on the next call
- row 2: fixed on the next call
- row 3: needed two calls
- row 4: routed around
- row 5: abandoned
"""


class FakeCodescout(types.ModuleType):
    class CodescoutError(Exception):
        pass

    def __init__(self):
        super().__init__("codescout")
        self.docs = {}
        self.updates = []
        self.after_update = None
        # The derived read of an opted-in checkout: rows and heads name a document by `rel_path`
        # and `key`, with no `id` and no `abs_path` (E4c-2).
        self.derived = False
        fake = self

        def named(row):
            if not fake.derived:
                return row
            row = dict(row)
            abs_path = row.pop("abs_path")
            row["rel_path"] = abs_path[len(ROOT) + 1 :]
            row["key"] = row.pop("id")
            return row

        class Doc:
            def find_iter(self, *, page=200, **filters):
                if BOX_DIR not in json.dumps(filters):
                    raise AssertionError(f"unexpected find: {filters}")
                rows = [
                    {"id": "readme-id", "title": "frictions", "status": "active", "kind": "collection",
                     "abs_path": f"{ROOT}/{BOX_DIR}/readme.md"}
                ]
                for d in fake.docs.values():
                    rows.append({k: d[k] for k in ("id", "title", "status", "abs_path")} | {"kind": "entry"})
                return iter([named(r) for r in rows])

            def get(self, **args):
                if args["id"] == "readme-id":
                    raise AssertionError("the readme is not an entry")
                d = fake.docs[args["id"]]
                return named({k: (dict(d[k]) if k == "extra" else d[k])
                              for k in ("id", "title", "status", "abs_path", "extra", "body")})

            def update(self, *, id, patch):
                fake.updates.append((id, patch))
                d = fake.docs[id]
                if "status" in patch:
                    d["status"] = patch["status"]
                d["extra"].update(patch.get("extra", {}))
                if "body" in patch:
                    d["body"] = patch["body"]
                if fake.after_update:
                    hook, fake.after_update = fake.after_update, None
                    hook(id)
                return {"id": id, "updated": True}

        class Box:
            def key(self):
                return "frictions"

            def dir(self):
                return BOX_DIR

        self.doc = Doc()
        self.box = Box()

    def add(self, key, status="open", fr=None, body=None, title=None):
        extra = {"entry_kind": "friction"}
        if fr:
            extra["fr"] = fr
        self.docs[key] = {
            "id": key,
            "title": title or f"Title of {key}",
            "status": status,
            "abs_path": f"{ROOT}/{BOX_DIR}/{key}.md",
            "extra": extra,
            "body": body if body is not None else f"## {fr} — Title of {key}\n\ntext\n",
        }


@pytest.fixture
def world(monkeypatch):
    fake = FakeCodescout()
    monkeypatch.setitem(sys.modules, "codescout", fake)
    monkeypatch.setenv("CODESCOUT_PROJECT", ROOT)
    spec = importlib.util.spec_from_file_location("frictions_admit_under_test", VERB_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fake.verb = module
    return fake


def run(world, monkeypatch, capsys, argv):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    code = world.verb.main(argv)
    return code, capsys.readouterr().out


def test_admit_gives_the_next_fr_and_writes_the_heading(world, monkeypatch, capsys):
    world.add("2026-11-10-a", fr="FR-1")
    world.add("2026-11-10-b", fr="FR-3", status="fixed-verified")
    world.add("2026-11-21-new", status="inbox", body=GOOD_BODY, title="The tool says nothing")
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 0, out
    assert len(world.updates) == 1
    entry_id, patch = world.updates[0]
    assert entry_id == "2026-11-21-new"
    assert patch["status"] == "open"
    assert patch["extra"] == {"fr": "FR-4"}
    assert patch["body"] == "## FR-4 — The tool says nothing\n\n" + GOOD_BODY


def test_admit_reads_rows_named_by_rel_path_and_key(world, monkeypatch, capsys):
    # On an opted-in checkout `find` and `get` name an entry by `rel_path` and `key`, with no `id`
    # and no `abs_path`: the entry is found by its key, read and written through it, and the rival
    # check tells it from the others by key.
    world.derived = True
    world.add("2026-11-10-a", fr="FR-1")
    world.add("2026-11-21-new", status="inbox", body=GOOD_BODY, title="The tool says nothing")
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 0, out
    [(entry_id, patch)] = world.updates
    assert entry_id == "2026-11-21-new"
    assert patch["extra"] == {"fr": "FR-2"}


def test_the_first_promotion_of_an_empty_collection_is_fr_1(world, monkeypatch, capsys):
    world.add("2026-11-21-new", status="inbox", body=GOOD_BODY)
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 0, out
    assert world.updates[0][1]["extra"] == {"fr": "FR-1"}
    assert world.verb.next_fr([]) == "FR-1"


def test_next_fr_reads_the_field_and_the_first_heading(world):
    entries = [
        {"extra": {"fr": "FR-2"}, "body": "no heading"},
        {"extra": {}, "body": "---\n\n## FR-9 — only a heading\n"},
        {"body": "## FR-4 — no extra key at all"},
    ]
    assert world.verb.next_fr(entries) == "FR-10"


def test_admit_refuses_a_body_without_the_evidence_parts_and_names_each_missing_part(
    world, monkeypatch, capsys
):
    world.add("2026-11-21-new", status="inbox", body="Just some text.\n")
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 2
    assert out.startswith(REFUSAL)
    for part in ("**Query:**", "**Window:**", "**Corpus:**", "**Recovery sample:**", "five recovery lines"):
        assert part in out
    assert world.updates == []


def test_four_recovery_lines_are_not_enough(world, monkeypatch, capsys):
    four = GOOD_BODY.replace("- row 5: abandoned\n", "")
    world.add("2026-11-21-new", status="inbox", body=four)
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 2
    assert "five recovery lines" in out
    assert "**Query:**" not in out
    assert world.updates == []
    assert world.verb.missing_parts(GOOD_BODY) == []


def test_recovery_lines_after_the_next_label_do_not_count(world):
    body = GOOD_BODY.replace("- row 5: abandoned\n", "\n**Notes:**\n\n- row 5: abandoned\n")
    assert world.verb.missing_parts(body) == ["five recovery lines"]


def test_a_label_with_no_text_is_missing_and_named(world, monkeypatch, capsys):
    empty = "**Query:**\n\n**Window:**\n\n**Corpus:**\n\n**Recovery sample:**\n\n" + "- a\n" * 5
    assert world.verb.missing_parts(empty) == [
        "**Query:** has no text",
        "**Window:** has no text",
        "**Corpus:** has no text",
    ]
    world.add("2026-11-21-new", status="inbox", body=empty)
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert (code, out.startswith(REFUSAL)) == (2, True)
    assert "**Query:** has no text" in out
    assert world.updates == []


def test_text_under_a_label_may_follow_in_the_next_paragraph(world):
    body = GOOD_BODY.replace("**Query:** `SELECT 1`", "**Query:**\n\n`SELECT 1`")
    assert world.verb.missing_parts(body) == []


def test_empty_bullets_do_not_count_as_recovery_lines(world):
    tail = "- row 3: needed two calls\n- row 4: routed around\n- row 5: abandoned\n"
    body = GOOD_BODY.replace(tail, "- \n- \n- \n")  # two real bullets stay: five lines, three empty
    assert world.verb.missing_parts(body) == ["five recovery lines"]



def test_admit_refuses_an_entry_that_is_not_inbox(world, monkeypatch, capsys):
    world.add("2026-11-10-a", status="open", fr="FR-1", body=GOOD_BODY)
    code, out = run(world, monkeypatch, capsys, ["2026-11-10-a"])
    assert code == 2
    assert out.startswith(REFUSAL)
    assert "inbox" in out
    assert world.updates == []


def test_admit_refuses_an_unknown_key(world, monkeypatch, capsys):
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-nothing"])
    assert (code, out.startswith(REFUSAL)) == (2, True)


def test_two_sequential_promotions_get_different_numbers(world, monkeypatch, capsys):
    world.add("2026-11-21-one", status="inbox", body=GOOD_BODY, title="One")
    world.add("2026-11-21-two", status="inbox", body=GOOD_BODY, title="Two")
    assert run(world, monkeypatch, capsys, ["2026-11-21-one"])[0] == 0
    assert run(world, monkeypatch, capsys, ["2026-11-21-two"])[0] == 0
    assert world.docs["2026-11-21-one"]["extra"]["fr"] == "FR-1"
    assert world.docs["2026-11-21-two"]["extra"]["fr"] == "FR-2"


def test_a_number_taken_between_read_and_write_is_bumped(world, monkeypatch, capsys):
    world.add("2026-11-21-new", status="inbox", body=GOOD_BODY, title="Mine")

    def other_session_takes_it(id):
        world.add("2026-11-21-other", status="open", fr=world.docs[id]["extra"]["fr"])

    world.after_update = other_session_takes_it
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 0, out
    mine = world.docs["2026-11-21-new"]
    assert mine["extra"]["fr"] == "FR-2"
    assert mine["body"].startswith("## FR-2 — Mine\n\n")
    assert "FR-1" not in mine["body"].splitlines()[0]
    assert "FR-2" in out


def test_a_number_that_stays_taken_is_refused_after_three_tries(world, monkeypatch, capsys):
    world.add("2026-11-21-new", status="inbox", body=GOOD_BODY, title="Mine")
    count = {"n": 0}

    def always_taken(id):
        count["n"] += 1
        world.add(f"2026-11-21-rival-{count['n']}", status="open", fr=world.docs[id]["extra"]["fr"])
        world.after_update = always_taken

    world.after_update = always_taken
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 2
    assert out.startswith(REFUSAL)
    assert "2026-11-21-new" in out and "2026-11-21-rival-" in out
    assert len(world.updates) == 3


def test_admit_prints_the_pathspec_commit_and_does_not_commit(world, monkeypatch, capsys):
    world.add("2026-11-21-new", status="inbox", body=GOOD_BODY, title="The tool says nothing")
    code, out = run(world, monkeypatch, capsys, ["2026-11-21-new"])
    assert code == 0, out
    path = f"{BOX_DIR}/2026-11-21-new.md"
    lines = out.splitlines()
    assert f"git add -- {path}" in lines
    assert f'git commit -m "docs(frictions): 2026-11-21-new is FR-1" -- {path}' in lines
    assert "subprocess" not in vars(world.verb)


def test_the_module_docstring_first_line_is_the_box_description(world):
    first = world.verb.__doc__.splitlines()[0]
    assert first == (
        "Admit an inbox friction as a verified entry with the next FR-N, and print the commit to run."
    )
