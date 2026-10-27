"""Tests for billing.is_in_grace_period.

Contract (from the docstring of the unit under test):

    is_in_grace_period(due, today) -> bool

    True exactly when an invoice that fell due on `due` is still inside its
    grace period on `today`. The grace period is GRACE_DAYS days long and
    begins on the due date; an invoice that is not yet due is not in its
    grace period. Pure function, no side effects.

That makes the in-grace window the half-open interval [due, due + GRACE_DAYS):
the due date itself counts (it is not "not yet due"), and a window that is
GRACE_DAYS days long starting at `due` closes before `due + GRACE_DAYS`.
See `test_last_day_of_grace_period` / `test_first_day_after_grace_period`,
which pin that upper boundary.
"""

from datetime import date, timedelta

import pytest

import billing
from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 3, 10)


@pytest.mark.parametrize(
    ("offset", "expected"),
    [
        (-30, False),  # long before the due date
        (-2, False),
        (-1, False),  # day before due: not yet due
        (0, True),  # due date itself
        (1, True),
        (2, True),
        (3, True),
        (4, True),  # last day of a 5-day grace period
        (5, False),  # grace period has closed
        (6, False),
        (30, False),  # long after the due date
    ],
)
def test_grace_period_window(offset, expected):
    """The whole window, day by day, around a due date."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is expected


def test_due_date_is_in_grace_period():
    """An invoice is in grace on the day it falls due."""
    assert is_in_grace_period(DUE, DUE) is True


def test_day_before_due_is_not_in_grace_period():
    """An invoice that is not yet due is not in its grace period."""
    assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


def test_last_day_of_grace_period():
    """The grace period is GRACE_DAYS days long counting the due date."""
    last_day = DUE + timedelta(days=GRACE_DAYS - 1)
    assert is_in_grace_period(DUE, last_day) is True


def test_first_day_after_grace_period():
    """The window is half-open: due + GRACE_DAYS is already outside it."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS)) is False


def test_grace_period_spans_exactly_grace_days_dates():
    """Exactly GRACE_DAYS distinct dates are in grace for a given due date."""
    in_grace = [
        DUE + timedelta(days=n)
        for n in range(-10, 20)
        if is_in_grace_period(DUE, DUE + timedelta(days=n))
    ]
    assert len(in_grace) == GRACE_DAYS
    assert in_grace[0] == DUE
    assert in_grace == [DUE + timedelta(days=n) for n in range(GRACE_DAYS)]


@pytest.mark.parametrize(
    ("due", "today", "expected"),
    [
        # Grace period running across a month boundary.
        (date(2026, 1, 30), date(2026, 2, 1), True),
        (date(2026, 1, 30), date(2026, 2, 3), True),
        (date(2026, 1, 30), date(2026, 2, 4), False),
        # Across a year boundary. Dec 30 + 5 days == Jan 4.
        (date(2025, 12, 30), date(2026, 1, 2), True),
        (date(2025, 12, 30), date(2026, 1, 3), True),
        (date(2025, 12, 30), date(2026, 1, 4), False),
        (date(2025, 12, 30), date(2025, 12, 29), False),
        # Across a leap day. Feb 2024 has 29 days, so Feb 27 + 5 days == Mar 3.
        (date(2024, 2, 27), date(2024, 3, 1), True),
        (date(2024, 2, 27), date(2024, 3, 2), True),
        (date(2024, 2, 27), date(2024, 3, 3), False),
        # Same due date in a non-leap year: no Feb 29, so the window reaches
        # one day further into March (Feb 27 + 5 days == Mar 4).
        (date(2025, 2, 27), date(2025, 3, 2), True),
        (date(2025, 2, 27), date(2025, 3, 3), True),
        (date(2025, 2, 27), date(2025, 3, 4), False),
        # Same calendar day number, different month: must not look "in grace".
        (date(2026, 1, 10), date(2026, 2, 10), False),
        # Same day and month, different year.
        (date(2025, 3, 10), date(2026, 3, 10), False),
    ],
)
def test_calendar_boundaries(due, today, expected):
    """Real date arithmetic, not day-of-month arithmetic."""
    assert is_in_grace_period(due, today) is expected


def test_arguments_are_not_interchangeable():
    """`due` and `today` play different roles and must not be swapped."""
    due = date(2026, 3, 10)
    today = due + timedelta(days=2)
    assert is_in_grace_period(due, today) is True
    assert is_in_grace_period(today, due) is False


@pytest.mark.parametrize("grace_days", [1, 3, 10])
def test_window_length_follows_grace_days(monkeypatch, grace_days):
    """The window length is GRACE_DAYS, not a hard-coded number of days."""
    monkeypatch.setattr(billing, "GRACE_DAYS", grace_days)
    assert billing.is_in_grace_period(DUE, DUE) is True
    assert (
        billing.is_in_grace_period(DUE, DUE + timedelta(days=grace_days - 1)) is True
    )
    assert billing.is_in_grace_period(DUE, DUE + timedelta(days=grace_days)) is False


def test_returns_bool():
    """The result is a real bool, not a truthy/falsy stand-in."""
    assert isinstance(is_in_grace_period(DUE, DUE), bool)
    assert isinstance(is_in_grace_period(DUE, DUE - timedelta(days=1)), bool)
