"""Characterisation tests for src/billing.py.

Written before a refactor of the module: these pin down the *current* observable
behaviour of `is_in_grace_period` so that a behaviour-preserving refactor stays
green and an accidental off-by-one goes red.

Most tests derive their dates from `GRACE_DAYS` rather than hard-coding a
5-day window, so they keep testing the right thing if the constant is retuned.
`test_grace_days_constant_is_five` is the deliberate exception: it is the single
place where the current value is pinned, so a change to the constant produces
one clear failure instead of a silent change in behaviour.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 6, 15)


# --- the constant itself ----------------------------------------------------


def test_grace_days_constant_is_five():
    """Pin the current grace-period length. Update deliberately, never casually."""
    assert GRACE_DAYS == 5


# --- boundaries of the window -----------------------------------------------


def test_due_date_itself_is_in_grace():
    """The window is closed at the lower end: an invoice is in grace on its due date."""
    assert is_in_grace_period(DUE, DUE) is True


def test_last_day_of_grace_is_in_grace():
    """The final day of the window is still grace (due + GRACE_DAYS - 1)."""
    last_day = DUE + timedelta(days=GRACE_DAYS - 1)
    assert is_in_grace_period(DUE, last_day) is True


def test_first_day_after_grace_is_not_in_grace():
    """The window is open at the upper end: due + GRACE_DAYS has already lapsed."""
    expiry = DUE + timedelta(days=GRACE_DAYS)
    assert is_in_grace_period(DUE, expiry) is False


def test_day_before_due_is_not_in_grace():
    """An invoice that is not yet due is not in its grace period."""
    assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


# --- the whole window, day by day -------------------------------------------


@pytest.mark.parametrize("offset", range(GRACE_DAYS))
def test_every_day_within_the_window_is_in_grace(offset: int):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is True


@pytest.mark.parametrize("offset", [-365, -30, -2, -1])
def test_days_before_due_are_never_in_grace(offset: int):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False


@pytest.mark.parametrize("extra", [0, 1, 2, 30, 365])
def test_days_from_expiry_onwards_are_never_in_grace(extra: int):
    today = DUE + timedelta(days=GRACE_DAYS + extra)
    assert is_in_grace_period(DUE, today) is False


def test_window_is_exactly_grace_days_long():
    """Counting over a wide span, exactly GRACE_DAYS days report as in grace."""
    span = range(-GRACE_DAYS * 2, GRACE_DAYS * 3)
    in_grace = [
        offset for offset in span if is_in_grace_period(DUE, DUE + timedelta(days=offset))
    ]
    assert in_grace == list(range(GRACE_DAYS))


# --- calendar arithmetic ----------------------------------------------------
#
# The window is defined in days, not in calendar positions, so it has to survive
# month ends, year ends and leap days. These are the cases a refactor that
# starts doing component-wise date maths would break.


def test_window_spans_a_month_boundary():
    due = date(2026, 1, 30)  # window runs 30 Jan - 3 Feb inclusive
    assert is_in_grace_period(due, date(2026, 2, 3)) is True
    assert is_in_grace_period(due, date(2026, 2, 4)) is False


def test_window_spans_a_year_boundary():
    due = date(2025, 12, 29)  # window runs 29 Dec - 2 Jan inclusive
    assert is_in_grace_period(due, date(2026, 1, 2)) is True
    assert is_in_grace_period(due, date(2026, 1, 3)) is False


def test_window_spans_a_leap_day():
    due = date(2024, 2, 27)  # 2024 is a leap year: window runs 27 Feb - 2 Mar
    assert is_in_grace_period(due, date(2024, 3, 2)) is True
    assert is_in_grace_period(due, date(2024, 3, 3)) is False


def test_invoice_due_on_a_leap_day():
    due = date(2024, 2, 29)
    assert is_in_grace_period(due, due) is True
    assert is_in_grace_period(due, date(2024, 3, 4)) is True
    assert is_in_grace_period(due, date(2024, 3, 5)) is False


# --- contract ---------------------------------------------------------------


@pytest.mark.parametrize("offset", [-1, 0, GRACE_DAYS - 1, GRACE_DAYS])
def test_returns_a_real_bool(offset: int):
    """Callers may serialise this result; it must be a bool, not merely truthy."""
    assert type(is_in_grace_period(DUE, DUE + timedelta(days=offset))) is bool


def test_does_not_mutate_its_arguments():
    due = date(2026, 6, 15)
    today = date(2026, 6, 17)
    is_in_grace_period(due, today)
    assert due == date(2026, 6, 15)
    assert today == date(2026, 6, 17)
