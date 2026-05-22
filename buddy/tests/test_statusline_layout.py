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
