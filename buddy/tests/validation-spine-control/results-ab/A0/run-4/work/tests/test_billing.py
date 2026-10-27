"""Characterization tests for src/billing.py.

These pin the *current* observable behaviour of `is_in_grace_period` so that an
upcoming refactor can be verified as behaviour-preserving. Most assertions use
concrete dates rather than arithmetic on GRACE_DAYS: a test that recomputes the
answer from the same constant the implementation uses would silently follow the
implementation wherever it went.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 3, 10)


class TestGraceDaysConstant:
    def test_grace_days_is_five(self):
        """The window length is part of the contract these tests encode."""
        assert GRACE_DAYS == 5


class TestBeforeDue:
    """An invoice that is not yet due is not in its grace period."""

    @pytest.mark.parametrize("days_early", [1, 2, 5, 6, 30, 365])
    def test_not_in_grace_before_due(self, days_early):
        today = DUE - timedelta(days=days_early)
        assert is_in_grace_period(DUE, today) is False

    def test_day_before_due_is_excluded(self):
        """Lower boundary: the day immediately before the due date."""
        assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


class TestInsideGracePeriod:
    def test_due_date_itself_is_in_grace(self):
        """Lower boundary: the grace period is inclusive of the due date."""
        assert is_in_grace_period(DUE, DUE) is True

    @pytest.mark.parametrize("days_late", [0, 1, 2, 3, 4])
    def test_each_day_of_the_window(self, days_late):
        today = DUE + timedelta(days=days_late)
        assert is_in_grace_period(DUE, today) is True

    def test_last_day_of_grace(self):
        """Upper boundary: day 4 (due + GRACE_DAYS - 1) is the final day inside."""
        assert is_in_grace_period(DUE, DUE + timedelta(days=4)) is True


class TestAfterGracePeriod:
    def test_first_day_after_grace_expires(self):
        """Upper boundary: day 5 is exclusive -- the window has lapsed."""
        assert is_in_grace_period(DUE, DUE + timedelta(days=5)) is False

    @pytest.mark.parametrize("days_late", [5, 6, 7, 30, 365])
    def test_not_in_grace_after_window(self, days_late):
        today = DUE + timedelta(days=days_late)
        assert is_in_grace_period(DUE, today) is False


class TestWindowShape:
    """Properties of the window as a whole, swept rather than spot-checked."""

    def test_sweep_around_due_date(self):
        """Exactly the offsets 0..4 fall inside; everything else is outside."""
        results = {
            offset: is_in_grace_period(DUE, DUE + timedelta(days=offset))
            for offset in range(-10, 11)
        }
        assert results == {offset: 0 <= offset <= 4 for offset in range(-10, 11)}

    def test_window_is_exactly_grace_days_long(self):
        """The count of in-grace days matches GRACE_DAYS, not just the literals above."""
        inside = [
            offset
            for offset in range(-30, 31)
            if is_in_grace_period(DUE, DUE + timedelta(days=offset))
        ]
        assert len(inside) == GRACE_DAYS

    def test_window_is_contiguous(self):
        inside = [
            offset
            for offset in range(-30, 31)
            if is_in_grace_period(DUE, DUE + timedelta(days=offset))
        ]
        assert inside == list(range(inside[0], inside[0] + len(inside)))


class TestCalendarBoundaries:
    """The window is counted in days, so it must cross calendar edges cleanly."""

    def test_crosses_month_boundary(self):
        due = date(2026, 1, 30)
        assert is_in_grace_period(due, date(2026, 1, 31)) is True
        assert is_in_grace_period(due, date(2026, 2, 3)) is True   # due + 4
        assert is_in_grace_period(due, date(2026, 2, 4)) is False  # due + 5

    def test_crosses_year_boundary(self):
        due = date(2026, 12, 30)
        assert is_in_grace_period(due, date(2026, 12, 31)) is True
        assert is_in_grace_period(due, date(2027, 1, 3)) is True   # due + 4
        assert is_in_grace_period(due, date(2027, 1, 4)) is False  # due + 5

    def test_crosses_leap_day(self):
        due = date(2028, 2, 27)
        assert is_in_grace_period(due, date(2028, 2, 29)) is True  # leap day, due + 2
        assert is_in_grace_period(due, date(2028, 3, 2)) is True   # due + 4
        assert is_in_grace_period(due, date(2028, 3, 3)) is False  # due + 5

    def test_crosses_non_leap_february(self):
        due = date(2026, 2, 26)
        assert is_in_grace_period(due, date(2026, 3, 2)) is True   # due + 4
        assert is_in_grace_period(due, date(2026, 3, 3)) is False  # due + 5

    def test_min_date_due(self):
        """A due date at the start of the representable range still works."""
        assert is_in_grace_period(date.min, date.min) is True
        assert is_in_grace_period(date.min, date.min + timedelta(days=5)) is False


class TestReturnType:
    def test_returns_actual_bool(self):
        """Callers may serialise the result; it must be a bool, not a truthy value."""
        assert isinstance(is_in_grace_period(DUE, DUE), bool)
        assert isinstance(is_in_grace_period(DUE, DUE + timedelta(days=99)), bool)
