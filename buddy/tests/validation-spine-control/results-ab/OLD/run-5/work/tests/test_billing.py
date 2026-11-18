"""Characterization tests for src/billing.py, written ahead of a refactor.

Expected values are derived from the docstring of `is_in_grace_period`:

    The grace period is GRACE_DAYS days long. An invoice that is not yet due is
    not in its grace period.

That fixes the window as the half-open interval [due, due + GRACE_DAYS): it opens
on the day the invoice falls due (anything earlier is "not yet due") and is
GRACE_DAYS days long.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 6, 10)


def test_grace_days_is_five():
    """The documented window length. Separate from the window tests below so a
    deliberate policy change shows up as one failure, not a dozen."""
    assert GRACE_DAYS == 5


@pytest.mark.parametrize(
    ("offset", "expected"),
    [
        (-60, False),  # long before the invoice falls due
        (-1, False),  # day before due: "not yet due is not in its grace period"
        (0, True),  # the day it falls due: window opens
        (1, True),
        (3, True),
        (4, True),  # last day of a 5-day window
        (5, False),  # window has closed
        (6, False),
        (60, False),  # long overdue
    ],
)
def test_window_by_day_offset(offset, expected):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is expected


def test_window_length_follows_grace_days():
    """The window is GRACE_DAYS long, not 5 days by coincidence. If GRACE_DAYS is
    retuned, these two must move with it."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS - 1)) is True
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS)) is False


@pytest.mark.parametrize(
    ("due", "today", "expected"),
    [
        # Window spanning a month end (30-day June into July).
        (date(2026, 6, 28), date(2026, 7, 2), True),
        (date(2026, 6, 28), date(2026, 7, 3), False),
        # Window spanning a year end.
        (date(2026, 12, 29), date(2027, 1, 2), True),
        (date(2026, 12, 29), date(2027, 1, 3), False),
        # Window spanning 29 February in a leap year.
        (date(2028, 2, 27), date(2028, 3, 2), True),
        (date(2028, 2, 27), date(2028, 3, 3), False),
        # Same calendar days in a non-leap year land one day earlier.
        (date(2027, 2, 27), date(2027, 3, 3), True),
        (date(2027, 2, 27), date(2027, 3, 4), False),
    ],
)
def test_window_spans_calendar_boundaries(due, today, expected):
    """Counting must be in elapsed days, not day-of-month arithmetic."""
    assert is_in_grace_period(due, today) is expected


def test_returns_a_bool():
    """The annotated return type, pinned so a refactor cannot leak a truthy
    non-bool (an int, a timedelta, a numpy bool) to callers."""
    assert isinstance(is_in_grace_period(DUE, DUE), bool)
    assert isinstance(is_in_grace_period(DUE, DUE + timedelta(days=99)), bool)
