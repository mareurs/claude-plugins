"""Characterization tests for src/billing.py.

Written ahead of a refactor: these pin down the *current* observable behaviour
of `is_in_grace_period` so that a restructuring can be checked for behavioural
equivalence. The grace period is the half-open interval [due, due + GRACE_DAYS).
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 6, 10)


class TestGraceDaysConstant:
    """The window length is part of the contract, not an implementation detail."""

    def test_grace_days_is_five(self):
        assert GRACE_DAYS == 5

    def test_grace_window_spans_exactly_grace_days_days(self):
        in_grace = [
            DUE + timedelta(days=offset)
            for offset in range(-30, 30)
            if is_in_grace_period(DUE, DUE + timedelta(days=offset))
        ]
        assert len(in_grace) == GRACE_DAYS

    def test_grace_window_starts_on_the_due_date(self):
        in_grace = [
            DUE + timedelta(days=offset)
            for offset in range(-30, 30)
            if is_in_grace_period(DUE, DUE + timedelta(days=offset))
        ]
        assert in_grace[0] == DUE

    def test_grace_window_is_contiguous(self):
        in_grace = [
            DUE + timedelta(days=offset)
            for offset in range(-30, 30)
            if is_in_grace_period(DUE, DUE + timedelta(days=offset))
        ]
        expected = [DUE + timedelta(days=n) for n in range(GRACE_DAYS)]
        assert in_grace == expected


class TestBoundaries:
    """The four days where an off-by-one would hide."""

    def test_day_before_due_is_not_in_grace(self):
        assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False

    def test_due_date_itself_is_in_grace(self):
        # Lower bound is inclusive: the invoice is due today, grace starts now.
        assert is_in_grace_period(DUE, DUE) is True

    def test_last_day_of_grace_is_in_grace(self):
        assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS - 1)) is True

    def test_first_day_after_grace_is_not_in_grace(self):
        # Upper bound is exclusive.
        assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS)) is False


class TestWithinAndOutsideWindow:
    @pytest.mark.parametrize("offset", range(0, GRACE_DAYS))
    def test_every_day_of_the_window_is_in_grace(self, offset):
        assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is True

    @pytest.mark.parametrize("offset", [-365, -31, -7, -2, -1])
    def test_not_yet_due_is_never_in_grace(self, offset):
        assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False

    @pytest.mark.parametrize("offset", [GRACE_DAYS, GRACE_DAYS + 1, 30, 365])
    def test_well_past_grace_is_not_in_grace(self, offset):
        assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False


class TestCalendarArithmetic:
    """Guards against a refactor that reaches for naive day-number arithmetic."""

    def test_window_crossing_a_month_boundary(self):
        due = date(2026, 1, 30)
        assert is_in_grace_period(due, date(2026, 2, 3)) is True   # due + 4
        assert is_in_grace_period(due, date(2026, 2, 4)) is False  # due + 5

    def test_window_crossing_a_year_boundary(self):
        due = date(2026, 12, 30)
        assert is_in_grace_period(due, date(2027, 1, 3)) is True   # due + 4
        assert is_in_grace_period(due, date(2027, 1, 4)) is False  # due + 5

    def test_window_crossing_a_leap_day(self):
        due = date(2028, 2, 26)
        assert is_in_grace_period(due, date(2028, 2, 29)) is True  # due + 3
        assert is_in_grace_period(due, date(2028, 3, 1)) is True   # due + 4
        assert is_in_grace_period(due, date(2028, 3, 2)) is False  # due + 5

    def test_window_crossing_a_non_leap_february(self):
        due = date(2026, 2, 26)
        assert is_in_grace_period(due, date(2026, 3, 1)) is True   # due + 3
        assert is_in_grace_period(due, date(2026, 3, 2)) is True   # due + 4
        assert is_in_grace_period(due, date(2026, 3, 3)) is False  # due + 5

    @pytest.mark.parametrize(
        "due",
        [date(1, 1, 1), date(9999, 12, 26)],
        ids=["date-min", "near-date-max"],
    )
    def test_extreme_dates_do_not_overflow(self, due):
        assert is_in_grace_period(due, due) is True
        assert is_in_grace_period(due, due + timedelta(days=GRACE_DAYS - 1)) is True
