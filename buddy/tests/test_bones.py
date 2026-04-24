"""Tests for bones.py — deterministic bodhisattva hatching."""
from scripts.bones import fnv1a, mulberry32, roll_form, FORMS


def test_fnv1a_known_value():
    assert fnv1a("hello") == 0x4f9f2cab


def test_fnv1a_different_inputs_differ():
    assert fnv1a("alice") != fnv1a("bob")


def test_fnv1a_empty_string():
    assert fnv1a("") == 0x811c9dc5


def test_mulberry32_deterministic():
    prng1 = mulberry32(42)
    prng2 = mulberry32(42)
    assert [prng1() for _ in range(5)] == [prng2() for _ in range(5)]


def test_mulberry32_different_seeds_diverge():
    prng1 = mulberry32(1)
    prng2 = mulberry32(2)
    assert prng1() != prng2()


def test_mulberry32_in_unit_interval():
    prng = mulberry32(42)
    for _ in range(100):
        v = prng()
        assert 0.0 <= v < 1.0


def test_roll_form_returns_valid_form():
    form = roll_form("alice@example.com")
    assert form in FORMS


def test_roll_form_deterministic():
    assert roll_form("alice@example.com") == roll_form("alice@example.com")


def test_roll_form_different_users_can_differ():
    results = {roll_form(f"user{i}") for i in range(50)}
    assert len(results) >= 5, "roll_form should have spread across forms"


def test_forms_count():
    assert len(FORMS) == 10
