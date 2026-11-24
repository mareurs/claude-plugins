"""Tests for `check.py` of the `frictions` box: the findings of the collection itself.

The script is loaded by path, with a fake `codescout` module in `sys.modules` that holds the entries
of the collection in a dict, as `test_admit.py` does.
"""
import importlib.util
import io
import json
import sys
import types
from pathlib import Path

import pytest

VERB_PATH = Path(__file__).resolve().parent.parent / "check.py"
ROOT = "/home/dev/checkout"
BOX_DIR = "docs/trackers/ledgers/frictions"


class FakeCodescout(types.ModuleType):
    class CodescoutError(Exception):
        pass

    def __init__(self):
        super().__init__("codescout")
        self.docs = {}
        fake = self

        class Doc:
            def find_iter(self, *, page=200, **filters):
                if BOX_DIR not in json.dumps(filters):
                    raise AssertionError(f"unexpected find: {filters}")
                rows = [
                    {"id": "readme-id", "title": "frictions", "status": "active",
                     "abs_path": f"{ROOT}/{BOX_DIR}/readme.md"}
                ]
                rows += [
                    {k: d[k] for k in ("id", "title", "status", "abs_path")} for d in fake.docs.values()
                ]
                return iter(rows)

            def get(self, **args):
                if args["id"] == "readme-id":
                    raise AssertionError("the readme is not an entry")
                return fake.docs[args["id"]]

            def create(self, **args):
                raise AssertionError("check must not write")

            def update(self, **args):
                raise AssertionError("check must not write")

        class Box:
            def key(self):
                return "frictions"

            def dir(self):
                return BOX_DIR

        self.doc = Doc()
        self.box = Box()

    def add(self, key, status="open", fr=None, heading=None, tags=()):
        extra = {"entry_kind": "friction"}
        if fr:
            extra["fr"] = fr
        body = f"## {heading} — Title\n\ntext\n" if heading else "text only\n"
        self.docs[key] = {
            "id": key,
            "title": f"Title of {key}",
            "status": status,
            "abs_path": f"{ROOT}/{BOX_DIR}/{key}.md",
            "extra": extra,
            "body": body,
            "tags": list(tags),
        }


@pytest.fixture
def world(monkeypatch):
    fake = FakeCodescout()
    monkeypatch.setitem(sys.modules, "codescout", fake)
    monkeypatch.setenv("CODESCOUT_PROJECT", ROOT)
    spec = importlib.util.spec_from_file_location("frictions_check_under_test", VERB_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fake.verb = module
    return fake


def run(world, monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    code = world.verb.main([])
    return code, capsys.readouterr().out


def test_two_entries_with_one_fr_are_a_finding(world, monkeypatch, capsys):
    world.add("2026-11-10-a", fr="FR-3", heading="FR-3")
    world.add("2026-11-10-b", fr="FR-3", heading="FR-3")
    world.add("2026-11-10-c", fr="FR-4", heading="FR-4")
    code, out = run(world, monkeypatch, capsys)
    assert code == 1
    lines = out.splitlines()
    assert len(lines) == 1
    assert "FR-3" in lines[0] and "2026-11-10-a" in lines[0] and "2026-11-10-b" in lines[0]


def test_a_number_held_by_a_field_in_one_entry_and_a_heading_in_another_is_a_finding(
    world, monkeypatch, capsys
):
    world.add("2026-11-10-a", fr="FR-7")
    world.add("2026-11-10-b", heading="FR-7")
    code, out = run(world, monkeypatch, capsys)
    assert code == 1
    assert "FR-7" in out and "2026-11-10-a" in out and "2026-11-10-b" in out


def test_an_fr_field_that_disagrees_with_the_heading_is_a_finding(world, monkeypatch, capsys):
    world.add("2026-11-10-a", fr="FR-3", heading="FR-5")
    code, out = run(world, monkeypatch, capsys)
    assert code == 1
    assert "2026-11-10-a" in out and "FR-3" in out and "FR-5" in out


@pytest.mark.parametrize("status", ["open", "fixing"])
def test_an_admitted_status_without_fr_is_a_finding(world, monkeypatch, capsys, status):
    world.add("2026-11-10-a", status=status)
    code, out = run(world, monkeypatch, capsys)
    assert code == 1
    assert "2026-11-10-a" in out and status in out and "no FR-N" in out


def test_an_inbox_entry_without_fr_is_clean(world, monkeypatch, capsys):
    world.add("2026-11-21-a", status="inbox")
    world.add("2026-11-21-b", status="wontfix")
    world.add("2026-11-21-c", status="not-a-friction")
    world.add("2026-11-21-d", status="duplicate")
    world.add("2026-11-21-e", status="fixed-verified")
    code, out = run(world, monkeypatch, capsys)
    assert (code, out) == (0, "")


def test_a_clean_collection_exits_0(world, monkeypatch, capsys):
    for n in range(1, 4):
        world.add(f"2026-11-10-e{n}", fr=f"FR-{n}", heading=f"FR-{n}")
    code, out = run(world, monkeypatch, capsys)
    assert (code, out) == (0, "")


def test_the_module_docstring_first_line_is_the_description(world):
    first = world.verb.__doc__.splitlines()[0]
    assert first == (
        "Check the frictions collection: an FR-N held twice, an fr that disagrees with its heading,"
        " an open or fixing entry with no FR-N."
    )


TEMPLATE_REL = "docs/trackers/frictions/entry-template.md"


def with_vocabulary(monkeypatch, tmp_path, *known):
    path = tmp_path / TEMPLATE_REL
    path.parent.mkdir(parents=True)
    bullets = "".join(f"- `{tag}` — meaning\n" for tag in known)
    path.write_text(f"# T\n\n## Known tags\n\n{bullets}\n## Next\n", encoding="utf-8")
    monkeypatch.setenv("CODESCOUT_PROJECT", str(tmp_path))


def test_a_tag_used_once_and_not_known_is_a_finding(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path, "system")
    world.add("2026-11-10-a", status="inbox", tags=["system", "brand-new"])
    code, out = run(world, monkeypatch, capsys)
    assert code == 1, out
    assert out.splitlines() == [
        "tag 'brand-new' is used once, by 2026-11-10-a, and is not in Known tags "
        "(docs/trackers/frictions/entry-template.md)"
    ]


def test_a_tag_used_once_and_known_is_clean(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path, "system")
    world.add("2026-11-10-a", status="inbox", tags=["system"])
    assert run(world, monkeypatch, capsys) == (0, "")


def test_a_tag_used_twice_is_clean_even_when_unknown(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path, "system")
    world.add("2026-11-10-a", status="inbox", tags=["brand-new"])
    world.add("2026-11-10-b", status="inbox", tags=["brand-new"])
    assert run(world, monkeypatch, capsys) == (0, "")


def test_a_missing_vocabulary_skips_the_tag_finding(world, monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("CODESCOUT_PROJECT", str(tmp_path))
    world.add("2026-11-10-a", status="inbox", tags=["brand-new"])
    assert run(world, monkeypatch, capsys) == (0, "")


def test_entries_without_tags_add_no_finding(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path, "system")
    world.add("2026-11-10-a", status="inbox")
    assert run(world, monkeypatch, capsys) == (0, "")


def test_an_entry_tag_that_drifts_from_a_known_tag_is_a_finding(world, monkeypatch, capsys, tmp_path):
    with_vocabulary(monkeypatch, tmp_path, "os-package")
    world.add("2026-11-10-a", status="inbox", tags=["os-packages"])
    world.add("2026-11-10-b", status="inbox", tags=["os-packages"])
    code, out = run(world, monkeypatch, capsys)
    assert code == 1, out
    assert out.splitlines() == [
        "tags 'os-package' and 'os-packages' differ only in spelling; keep one"
    ]


def test_two_known_tags_that_differ_only_in_spelling_are_a_finding(
    world, monkeypatch, capsys, tmp_path
):
    with_vocabulary(monkeypatch, tmp_path, "os-package", "os_package")
    world.add("2026-11-10-a", status="inbox")
    code, out = run(world, monkeypatch, capsys)
    assert code == 1, out
    assert out.splitlines() == [
        "tags 'os-package' and 'os_package' differ only in spelling; keep one"
    ]


def test_entry_tags_that_drift_among_themselves_are_left_to_the_core_check(
    world, monkeypatch, capsys, tmp_path
):
    with_vocabulary(monkeypatch, tmp_path, "system")
    world.add("2026-11-10-a", status="inbox", tags=["python-env", "system"])
    world.add("2026-11-10-b", status="inbox", tags=["python_env", "system"])
    world.add("2026-11-10-c", status="inbox", tags=["python-env"])
    world.add("2026-11-10-d", status="inbox", tags=["python_env"])
    assert run(world, monkeypatch, capsys) == (0, "")
