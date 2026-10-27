"""Characterization tests for billing helpers.

These pin the *current* behaviour of `is_in_grace_period` so that an upcoming
refactor can be checked for behavioural drift. Where a test captures something
that looks incidental rather than intended, it says so.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 3, 10)


def test_grace_days_is_five():
    """The concrete boundaries below assume a five-day window."""
    assert GRACE_DAYS == 5


# --- The four boundaries -------------------------------------------------


def test_day_before_due_is_not_in_grace():
    assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


def test_due_date_itself_is_in_grace():
    """The window is inclusive of the due date."""
    assert is_in_grace_period(DUE, DUE) is True


def test_last_day_of_grace_is_in_grace():
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS - 1)) is True


def test_first_day_after_grace_is_not_in_grace():
    """The window is exclusive of `due + GRACE_DAYS`."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS)) is False


# --- Window shape --------------------------------------------------------


@pytest.mark.parametrize(
    ("offset", "expected"),
    [
        (-30, False),
        (-2, False),
        (-1, False),
        (0, True),
        (1, True),
        (2, True),
        (3, True),
        (4, True),
        (5, False),
        (6, False),
        (30, False),
    ],
)
def test_offsets_from_due_date(offset, expected):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is expected


def test_grace_window_is_contiguous_and_tracks_grace_days():
    """Exactly GRACE_DAYS consecutive days qualify, starting on the due date.

    Derived from GRACE_DAYS rather than hard-coded, so this keeps holding if
    the constant is retuned; `test_grace_days_is_five` guards the value itself.
    """
    offsets = range(-10, GRACE_DAYS + 10)
    in_grace = [o for o in offsets if is_in_grace_period(DUE, DUE + timedelta(days=o))]

    assert in_grace == list(range(GRACE_DAYS))


# --- Calendar arithmetic -------------------------------------------------


@pytest.mark.parametrize(
    ("due", "today", "expected", "label"),
    [
        (date(2026, 1, 30), date(2026, 2, 3), True, "across a month boundary"),
        (date(2026, 1, 30), date(2026, 2, 4), False, "past grace, next month"),
        (date(2025, 12, 29), date(2026, 1, 2), True, "across a year boundary"),
        (date(2025, 12, 29), date(2026, 1, 3), False, "past grace, next year"),
        (date(2024, 2, 27), date(2024, 3, 2), True, "across a leap day"),
        (date(2024, 2, 27), date(2024, 3, 3), False, "past grace, leap year"),
        (date(2026, 2, 26), date(2026, 3, 2), True, "across a non-leap February"),
        (date(2026, 2, 26), date(2026, 3, 3), False, "past grace, non-leap year"),
    ],
)
def test_window_spans_calendar_boundaries(due, today, expected, label):
    assert is_in_grace_period(due, today) is expected, label


# --- Edge cases ----------------------------------------------------------


def test_far_future_due_date_is_not_in_grace():
    assert is_in_grace_period(date(2099, 1, 1), DUE) is False


def test_date_min_due_date_is_handled():
    assert is_in_grace_period(date.min, date.min) is True
    assert is_in_grace_period(date.min, date.min + timedelta(days=GRACE_DAYS)) is False


def test_due_date_at_date_max_overflows():
    """Current behaviour: computing `due + GRACE_DAYS` raises near date.max.

    Documented rather than endorsed — if the refactor returns True here
    instead, that is a deliberate improvement, not a regression.
    """
    with pytest.raises(OverflowError):
        is_in_grace_period(date.max, date.max)
