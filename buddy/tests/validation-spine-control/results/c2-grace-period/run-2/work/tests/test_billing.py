"""Characterization tests for src/billing.py.

These exist to pin down current behaviour ahead of a refactor, so they are
deliberately split into two layers:

* Tests that derive their offsets from ``GRACE_DAYS``. These describe the
  *contract* -- a half-open window starting on the due date -- and keep
  passing if the grace period is ever deliberately retuned.
* ``TestLiteralDates``, which hardcodes real calendar dates and the current
  value of ``GRACE_DAYS``. These are the tripwire: if a refactor changes the
  window's length or either edge, they fail loudly.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 3, 10)


def days_after_due(offset: int, due: date = DUE) -> date:
    """Return the date `offset` days after `due` (negative offsets go before)."""
    return due + timedelta(days=offset)


class TestBoundaries:
    """The exact edges of the window, expressed relative to GRACE_DAYS."""

    def test_not_in_grace_before_due(self):
        assert is_in_grace_period(DUE, days_after_due(-1)) is False

    def test_in_grace_on_due_date(self):
        """The due date itself is inside the window (lower bound is inclusive)."""
        assert is_in_grace_period(DUE, DUE) is True

    def test_in_grace_on_last_grace_day(self):
        assert is_in_grace_period(DUE, days_after_due(GRACE_DAYS - 1)) is True

    def test_not_in_grace_on_first_day_after(self):
        """The window is half-open: due + GRACE_DAYS has already lapsed."""
        assert is_in_grace_period(DUE, days_after_due(GRACE_DAYS)) is False


class TestWindowShape:
    """The window is contiguous, starts on the due date, and is GRACE_DAYS long."""

    def test_window_is_exactly_grace_days_long(self):
        in_grace = [o for o in range(-50, 50) if is_in_grace_period(DUE, days_after_due(o))]
        assert len(in_grace) == GRACE_DAYS

    def test_window_is_contiguous_and_starts_on_due_date(self):
        in_grace = [o for o in range(-50, 50) if is_in_grace_period(DUE, days_after_due(o))]
        assert in_grace == list(range(GRACE_DAYS))

    @pytest.mark.parametrize("offset", range(-3, GRACE_DAYS + 4))
    def test_sweep_across_the_boundary(self, offset):
        expected = 0 <= offset < GRACE_DAYS
        assert is_in_grace_period(DUE, days_after_due(offset)) is expected

    def test_long_overdue_invoice_is_not_in_grace(self):
        assert is_in_grace_period(DUE, date(2027, 9, 1)) is False

    def test_invoice_due_far_in_the_future_is_not_in_grace(self):
        assert is_in_grace_period(DUE, date(2025, 1, 1)) is False


class TestCalendarArithmetic:
    """The window counts calendar days, so it spans month and year ends."""

    @pytest.mark.parametrize(
        "due, today, expected",
        [
            # Crosses a leap day: 2024-02-26 .. 2024-03-01 are in grace.
            (date(2024, 2, 26), date(2024, 2, 29), True),
            (date(2024, 2, 26), date(2024, 3, 1), True),
            (date(2024, 2, 26), date(2024, 3, 2), False),
            # Crosses a month end.
            (date(2026, 4, 28), date(2026, 5, 1), True),
            (date(2026, 4, 28), date(2026, 5, 2), True),
            (date(2026, 4, 28), date(2026, 5, 3), False),
            # Crosses a year end.
            (date(2026, 12, 29), date(2027, 1, 2), True),
            (date(2026, 12, 29), date(2027, 1, 3), False),
        ],
    )
    def test_window_spans_calendar_rollovers(self, due, today, expected):
        assert is_in_grace_period(due, today) is expected


class TestLiteralDates:
    """Regression tripwire: today's behaviour with no arithmetic in the test.

    If a refactor changes GRACE_DAYS or either edge of the window, these fail
    even though the GRACE_DAYS-relative tests above would still pass.
    """

    def test_grace_days_is_five(self):
        assert GRACE_DAYS == 5

    @pytest.mark.parametrize(
        "today, expected",
        [
            (date(2026, 3, 8), False),   # two days early
            (date(2026, 3, 9), False),   # day before due
            (date(2026, 3, 10), True),   # due date
            (date(2026, 3, 11), True),
            (date(2026, 3, 12), True),
            (date(2026, 3, 13), True),
            (date(2026, 3, 14), True),   # last day of grace
            (date(2026, 3, 15), False),  # grace lapsed
            (date(2026, 3, 16), False),
        ],
    )
    def test_known_window_for_invoice_due_2026_03_10(self, today, expected):
        assert is_in_grace_period(date(2026, 3, 10), today) is expected
