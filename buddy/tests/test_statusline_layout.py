"""Tests for side-by-side statusline layout helpers."""
import os
from unittest import mock

from scripts.statusline import (
    SPECIALIST_ROLE,
    _terminal_width,
    _visible_width,
)


def test_specialist_role_covers_all_known_specialists():
    expected = {
        "debugging-yeti",
        "refactoring-yak",
        "testing-snow-leopard",
        "performance-lammergeier",
        "security-ibex",
        "architecture-snow-lion",
        "planning-crane",
        "docs-lotus-frog",
        "data-leakage-snow-pheasant",
        "ml-training-takin",
        "prompt-hamsa",
        "codescout-pika",
    }
    assert set(SPECIALIST_ROLE.keys()) == expected


def test_specialist_role_values_are_lowercase_roles():
    assert SPECIALIST_ROLE["debugging-yeti"] == "debugger"
    assert SPECIALIST_ROLE["architecture-snow-lion"] == "architect"
    assert SPECIALIST_ROLE["security-ibex"] == "security"


def test_visible_width_strips_ansi_csi():
    assert _visible_width("\x1b[31mok\x1b[0m") == 2
    assert _visible_width("\x1b[38;5;172m[CAVEMAN]\x1b[0m") == 9
    assert _visible_width("plain") == 5
    assert _visible_width("") == 0


def test_terminal_width_reads_columns_env():
    with mock.patch.dict(os.environ, {"COLUMNS": "120"}, clear=False):
        assert _terminal_width() == 120


def test_terminal_width_falls_back_when_columns_unset(monkeypatch):
    monkeypatch.delenv("COLUMNS", raising=False)
    with mock.patch(
        "scripts.statusline.shutil.get_terminal_size",
        return_value=os.terminal_size((100, 24)),
    ):
        assert _terminal_width() == 100


def test_terminal_width_returns_80_when_shutil_raises(monkeypatch):
    monkeypatch.delenv("COLUMNS", raising=False)
    with mock.patch(
        "scripts.statusline.shutil.get_terminal_size",
        side_effect=OSError(),
    ):
        assert _terminal_width() == 80


def test_terminal_width_ignores_nonpositive_columns(monkeypatch):
    monkeypatch.setenv("COLUMNS", "0")
    with mock.patch(
        "scripts.statusline.shutil.get_terminal_size",
        return_value=os.terminal_size((100, 24)),
    ):
        assert _terminal_width() == 100



from scripts.statusline import _format_specialists


def test_format_specialists_empty_returns_empty_string():
    assert _format_specialists([], []) == ""


def test_format_specialists_one_uses_full_label():
    active = ["debugging-yeti"]
    pairs = [("debugging-yeti", "Yeti")]
    assert _format_specialists(active, pairs) == "Yeti"


def test_format_specialists_two_uses_full_labels_comma_joined():
    active = ["debugging-yeti", "testing-snow-leopard"]
    pairs = [("debugging-yeti", "Yeti"), ("testing-snow-leopard", "Snow Leopard")]
    assert _format_specialists(active, pairs) == "Yeti, Snow Leopard"


def test_format_specialists_three_uses_role_names():
    active = [
        "debugging-yeti",
        "testing-snow-leopard",
        "architecture-snow-lion",
    ]
    pairs = [
        ("debugging-yeti", "Yeti"),
        ("testing-snow-leopard", "Snow Leopard"),
        ("architecture-snow-lion", "Snow Lion"),
    ]
    assert _format_specialists(active, pairs) == "debugger, tester, architect"


def test_format_specialists_unknown_slug_falls_back_to_short():
    active = ["debugging-yeti", "testing-snow-leopard", "future-unknown-slug"]
    pairs = [
        ("debugging-yeti", "Yeti"),
        ("testing-snow-leopard", "Snow Leopard"),
        ("future-unknown-slug", "Future"),
    ]
    result = _format_specialists(active, pairs)
    assert result.startswith("debugger, tester, ")
    assert result.endswith("future-unknown-slug")


def test_format_specialists_active_is_authoritative_when_pairs_partial():
    active = ["debugging-yeti", "missing-slug"]
    pairs = [("debugging-yeti", "Yeti")]
    assert _format_specialists(active, pairs) == "Yeti, missing-slug"


from scripts.statusline import _compose_rows


def test_compose_rows_basic_side_by_side():
    base = "env\n   .~~.\n  (°‿°)\n   \\_/\n  ~~~~~"
    segments = ["", "Owl · flow", "tester", "", "[ok] plan"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert lines[0].rstrip() == "env"
    assert "Owl · flow" in lines[1]
    assert "tester" in lines[2]
    # slot 3 empty but art row 3 present → art piece padded, empty right column
    assert lines[3].rstrip() == "   \\_/"
    assert "[ok] plan" in lines[4]


def test_compose_rows_trailing_empty_segments_dropped():
    base = "env\n   .~~.\n  (°‿°)\n   \\_/\n  ~~~~~"
    segments = ["", "Owl · flow", "", "", ""]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert len(lines) == 5
    assert lines[2].rstrip() == "  (°‿°)"
    assert lines[3].rstrip() == "   \\_/"
    assert lines[4].rstrip() == "  ~~~~~"


def test_compose_rows_short_art_more_segments():
    base = "env\nART"
    segments = ["", "slot1", "slot2", "slot3"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert len(lines) == 4
    assert lines[0].rstrip() == "env"
    assert lines[1].endswith("slot1")
    assert lines[2].endswith("slot2")
    assert lines[3].endswith("slot3")
    assert "ART" in lines[1]


def test_compose_rows_tall_art_few_segments():
    base = "env\n.\n.\n.\n.\n."
    segments = ["", "slot1", "slot2"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert len(lines) == 6


def test_compose_rows_specialists_pass_through_uncapped():
    base = "env\nA\nB\nC"
    long_specialists = "architect, tester, security, perf, debugger, refactorer"
    short_recon = "[recon]"
    segments = ["", "form · mood", long_specialists, short_recon]
    output = _compose_rows(base, segments, term_w=30)
    lines = output.split("\n")
    assert long_specialists in lines[2]
    assert "…" not in lines[2]
    assert "[recon]" in lines[3]



def test_compose_rows_truncates_recon_when_over_budget():
    base = "env\nA\nB\nC"
    long_recon = "[recon F12/W34 + cluttered " + "x" * 80 + "]"
    segments = ["", "form · mood", "", long_recon]
    output = _compose_rows(base, segments, term_w=30)
    lines = output.split("\n")
    assert "…" in lines[3]


def test_compose_rows_truncated_visible_width_within_budget():
    base = "env\nABC"
    long = "x" * 200
    segments = ["", long]
    output = _compose_rows(base, segments, term_w=40)
    lines = output.split("\n")
    assert _visible_width(lines[1]) <= 40


def test_compose_rows_no_trailing_newline():
    base = "env\nA"
    segments = ["", "slot1"]
    output = _compose_rows(base, segments, term_w=200)
    assert not output.endswith("\n")


def test_compose_rows_empty_middle_slot_preserves_pinning():
    base = "env\nA\nB\nC\nD"
    segments = ["", "form", "", "[recon]", "[ok]"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert lines[2].rstrip() == "B"
    assert "[recon]" in lines[3]
    assert "[ok]" in lines[4]



from scripts.statusline import _truncate_visible


def test_truncate_visible_zero_width_returns_empty():
    assert _truncate_visible("anything", 0) == ""
    assert _truncate_visible("anything", -5) == ""


def test_truncate_visible_short_string_unchanged():
    assert _truncate_visible("abc", 10) == "abc"
    assert _truncate_visible("", 10) == ""


def test_truncate_visible_ascii_truncation_appends_ellipsis():
    result = _truncate_visible("abcdefghij", 5)
    assert result == "abcd…"
    assert _visible_width(result) == 5


def test_truncate_visible_preserves_trailing_reset_when_csi_present():
    src = "\x1b[32mok this is a long success message\x1b[0m"
    result = _truncate_visible(src, 10)
    assert result.endswith("\x1b[0m")
    assert "…" in result
    assert _visible_width(result) == 10


def test_truncate_visible_appends_reset_when_csi_is_mid_string():
    src = "\x1b[32m[ok] verdict: text\x1b[0m (+3)"
    result = _truncate_visible(src, 12)
    assert result.endswith("\x1b[0m")
    assert _visible_width(result) == 12


def test_truncate_visible_no_csi_no_trailing_reset():
    src = "plain long ascii content"
    result = _truncate_visible(src, 8)
    assert not result.endswith("\x1b[0m")
    assert result.endswith("…")


from scripts.statusline import _compose_segments


def test_compose_segments_slot_0_always_empty():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[0] == ""


def test_compose_segments_slot_1_always_form_mood():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[1] == "Owl · flow"


def test_compose_segments_specialists_slot_2():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="architect, tester",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[2] == "architect, tester"


def test_compose_segments_suggested_and_recon_combined_slot_3():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested="debugging-yeti",
        specialists_line="",
        recon_badge="[recon]",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert "yeti nearby" in segs[3]
    assert "[recon]" in segs[3]


def test_compose_segments_suggested_only_slot_3():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested="debugging-yeti",
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[3] == "yeti nearby"


def test_compose_segments_recon_only_slot_3():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="[recon]",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[3] == "[recon]"


def test_compose_segments_verdict_slot_4_cs_verdict_slot_5():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="[ok] plan",
        cs_verdict_bubble="[cs!] iron",
    )
    assert segs[4] == "[ok] plan"
    assert segs[5] == "[cs!] iron"


def test_compose_segments_returns_7_slots_always():
    # Historical name; the contract is now 8 slots (slot 6 = cs skills, slot 7 = other).
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert len(segs) == 8
    assert segs[6] == ""  # codescout-skills slot defaults empty
    assert segs[7] == ""  # other-skills slot defaults empty


def test_compose_segments_skills_slot_carries_ledger_line():
    # cs skills land in slot 6, other skills in slot 7.
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
        cs_skills_line="cs: reconnaissance",
        skills_line="skills: tdd",
    )
    assert segs[6] == "cs: reconnaissance"
    assert segs[7] == "skills: tdd"


def test_format_skills_short_names_and_cap():
    from scripts.statusline import _format_skills
    assert _format_skills([]) == ""
    assert _format_skills(["codescout-companion:reconnaissance"]) == "skills: reconnaissance"
    assert _format_skills(["codescout-companion:reconnaissance"], label="cs") == "cs: reconnaissance"
    many = [f"p:skill-{i}" for i in range(6)]
    line = _format_skills(many)
    assert line.endswith(" …") and "skill-3" in line and "skill-4" not in line


def test_partition_skills_splits_codescout_from_other():
    from scripts.statusline import _partition_skills
    cs, other = _partition_skills([
        "codescout-companion:reconnaissance",
        "superpowers:test-driven-development",
        "codescout-companion:dashboard",
        "hookify:hookify",
    ])
    assert cs == ["codescout-companion:reconnaissance", "codescout-companion:dashboard"]
    assert other == ["superpowers:test-driven-development", "hookify:hookify"]
    assert _partition_skills([]) == ([], [])



# --- Task 5: render() side-by-side integration tests ---

import json
from pathlib import Path

from scripts.statusline import render
from scripts.state import default_state

DATA_DIR = Path(__file__).parent.parent / "data"
BODHIS = json.loads((DATA_DIR / "bodhisattvas.json").read_text())
ENV = json.loads((DATA_DIR / "environment.json").read_text())


def _identity(form="owl-of-clear-seeing"):
    return {
        "version": 1,
        "form": form,
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }


def test_render_side_by_side_form_mood_on_row_1(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    lines = output.split("\n")
    # row 0 is env strip, row 1 is first art row + "Owl · flow"
    assert "Owl" in lines[1]
    assert "flow" in lines[1]


def test_render_no_specialists_keeps_slot_2_blank(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    lines = output.split("\n")
    for line in lines[2:]:
        assert "," not in line  # no specialists list


def test_render_three_specialists_uses_role_names(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    state["active_specialists"] = [
        "debugging-yeti",
        "testing-snow-leopard",
        "architecture-snow-lion",
    ]
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    assert "debugger" in output
    assert "tester" in output
    assert "architect" in output
    assert "Yeti" not in output


def test_render_one_specialist_uses_full_label(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    state["active_specialists"] = ["debugging-yeti"]
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    assert "Debugging Yeti" in output
    assert "debugger" not in output


def test_render_narrow_terminal_does_not_truncate_specialists(monkeypatch):
    monkeypatch.setenv("COLUMNS", "30")
    state = default_state()
    state["active_specialists"] = [
        "debugging-yeti",
        "testing-snow-leopard",
        "architecture-snow-lion",
        "security-ibex",
        "performance-lammergeier",
    ]
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    for role in ("debugger", "tester", "architect", "security", "perf"):
        assert role in output


def test_render_fallback_no_form_returns_single_line(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    output = render(
        identity=_identity(form="nonexistent-form"),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    assert "\n" not in output
    assert "Lin" in output
