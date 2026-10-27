"""Tests for billing.is_in_grace_period.

Contract under test (taken from the function's docstring, not from its body):

    is_in_grace_period(due, today) is True exactly when `today` falls within the
    GRACE_DAYS-day window that begins on `due`. That window covers GRACE_DAYS
    distinct days: `due`, `due + 1`, ... `due + GRACE_DAYS - 1`. It is False
    before `due` ("an invoice that is not yet due is not in its grace period")
    and False from `due + GRACE_DAYS` onward.
"""

from datetime import date, timedelta

import pytest

import billing
from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 6, 10)


# --- The two boundaries the docstring is explicit about -------------------


def test_on_the_due_date_is_in_grace():
    """The window opens on `due` itself: only *not yet due* is excluded."""
    assert is_in_grace_period(DUE, DUE) is True


def test_day_before_due_is_not_in_grace():
    """'An invoice that is not yet due is not in its grace period.'"""
    assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


def test_last_day_of_grace_is_in_grace():
    """A GRACE_DAYS-long window spans due .. due + GRACE_DAYS - 1 inclusive."""
    last_day = DUE + timedelta(days=GRACE_DAYS - 1)
    assert is_in_grace_period(DUE, last_day) is True


def test_first_day_after_grace_is_not_in_grace():
    """Day GRACE_DAYS would be the (GRACE_DAYS + 1)th day — one too many."""
    expired = DUE + timedelta(days=GRACE_DAYS)
    assert is_in_grace_period(DUE, expired) is False


# --- The window as a whole ------------------------------------------------


@pytest.mark.parametrize("offset", range(GRACE_DAYS))
def test_every_day_of_the_window_is_in_grace(offset):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is True


@pytest.mark.parametrize("offset", [-365, -30, -2, -1])
def test_days_before_due_are_never_in_grace(offset):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False


@pytest.mark.parametrize("offset", [0, 1, 2, 30, 365])
def test_days_from_window_end_onward_are_never_in_grace(offset):
    today = DUE + timedelta(days=GRACE_DAYS + offset)
    assert is_in_grace_period(DUE, today) is False


def test_window_covers_exactly_grace_days_days():
    """Count the True days directly: a 'GRACE_DAYS days long' period has GRACE_DAYS of them."""
    scanned = [DUE + timedelta(days=n) for n in range(-10, 30)]
    in_grace = [d for d in scanned if is_in_grace_period(DUE, d)]
    assert len(in_grace) == GRACE_DAYS
    assert in_grace[0] == DUE


# --- Calendar arithmetic, not day-number arithmetic -----------------------


def test_grace_window_spans_a_month_boundary():
    """Due 29 Jan, so the window runs into February; day-of-month math would break."""
    due = date(2026, 1, 29)
    assert is_in_grace_period(due, date(2026, 2, 2)) is True  # due + 4
    assert is_in_grace_period(due, date(2026, 2, 3)) is False  # due + 5


def test_grace_window_spans_a_year_boundary():
    due = date(2026, 12, 29)
    assert is_in_grace_period(due, date(2027, 1, 2)) is True  # due + 4
    assert is_in_grace_period(due, date(2027, 1, 3)) is False  # due + 5


def test_grace_window_spans_leap_day():
    """2028 is a leap year: 26 Feb + 4 days is 1 Mar, not 2 Mar."""
    due = date(2028, 2, 26)
    assert is_in_grace_period(due, date(2028, 3, 1)) is True  # due + 4
    assert is_in_grace_period(due, date(2028, 3, 2)) is False  # due + 5


def test_grace_window_spans_non_leap_february():
    due = date(2026, 2, 26)
    assert is_in_grace_period(due, date(2026, 3, 2)) is True  # due + 4
    assert is_in_grace_period(due, date(2026, 3, 3)) is False  # due + 5


# --- The length is driven by the constant ---------------------------------


@pytest.mark.parametrize("grace", [0, 1, 3, 10])
def test_window_length_follows_grace_days_constant(monkeypatch, grace):
    """The docstring defines the window in terms of GRACE_DAYS, so a refactor
    must not hardcode today's value of 5."""
    monkeypatch.setattr(billing, "GRACE_DAYS", grace)

    in_grace = [
        DUE + timedelta(days=n)
        for n in range(-3, 20)
        if billing.is_in_grace_period(DUE, DUE + timedelta(days=n))
    ]
    assert len(in_grace) == grace
    if grace:
        assert in_grace[0] == DUE
        assert in_grace[-1] == DUE + timedelta(days=grace - 1)


# --- Shape of the return value --------------------------------------------


@pytest.mark.parametrize("offset", [-1, 0, GRACE_DAYS - 1, GRACE_DAYS])
def test_returns_a_real_bool(offset):
    """Callers may serialise this straight to JSON; a truthy timedelta is not a bool."""
    result = is_in_grace_period(DUE, DUE + timedelta(days=offset))
    assert type(result) is bool
