"""Tests for src/billing.py.

Expectations here are derived from the module's own docstrings, which state:

  1. "The grace period is GRACE_DAYS days long."
  2. "An invoice that is not yet due is not in its grace period."

Statement 2 fixes the lower edge: today < due is False. Statement 1 fixes the
*width* of the window but not where it starts, so the start edge is covered by
a separate, explicitly-labelled characterisation test (see
TestGraceWindowStartEdge).
"""

from datetime import date, timedelta

import pytest

import billing
from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 3, 10)


def day(offset: int, due: date = DUE) -> date:
    """The date `offset` days from `due`."""
    return due + timedelta(days=offset)


class TestNotYetDue:
    """Spec: "An invoice that is not yet due is not in its grace period." """

    @pytest.mark.parametrize("offset", [-1, -2, -GRACE_DAYS, -30, -365])
    def test_before_due_date_is_not_in_grace(self, offset):
        assert is_in_grace_period(DUE, day(offset)) is False


class TestGraceWindowWidth:
    """Spec: "The grace period is GRACE_DAYS days long."

    These assertions constrain the window's width without assuming where it
    begins, so they hold under either reading of the start edge.
    """

    def test_exactly_grace_days_days_fall_in_the_window(self):
        span = [day(o) for o in range(-365, 365)]
        in_grace = [d for d in span if is_in_grace_period(DUE, d)]
        assert len(in_grace) == GRACE_DAYS

    def test_the_window_is_one_contiguous_run_of_days(self):
        span = [day(o) for o in range(-365, 365)]
        in_grace = [d for d in span if is_in_grace_period(DUE, d)]
        assert in_grace == [in_grace[0] + timedelta(days=n) for n in range(len(in_grace))]

    def test_window_width_tracks_the_grace_days_constant(self, monkeypatch):
        # The docstring names GRACE_DAYS as the source of the width, so the
        # width must follow the constant rather than a hardcoded 5.
        monkeypatch.setattr(billing, "GRACE_DAYS", 9)
        span = [day(o) for o in range(-365, 365)]
        in_grace = [d for d in span if is_in_grace_period(DUE, d)]
        assert len(in_grace) == 9

    def test_window_width_tracks_the_constant_when_shrunk(self, monkeypatch):
        monkeypatch.setattr(billing, "GRACE_DAYS", 1)
        span = [day(o) for o in range(-365, 365)]
        in_grace = [d for d in span if is_in_grace_period(DUE, d)]
        assert len(in_grace) == 1

    def test_zero_grace_days_means_no_grace_period(self, monkeypatch):
        monkeypatch.setattr(billing, "GRACE_DAYS", 0)
        span = [day(o) for o in range(-365, 365)]
        assert [d for d in span if is_in_grace_period(DUE, d)] == []


class TestGraceWindowStartEdge:
    """The due date itself.

    The docstring does not say in so many words whether the window opens on
    `due` or on the day after. It says only that an invoice "not yet due" is
    excluded -- a remark that would be pointless under the day-after reading,
    since then the due date would be excluded too. So the due-date-inclusive
    reading is the better one, and it is what the current code does.

    This is the one expectation in the file that is a judgement call. If a
    refactor flips it, that is a real behaviour change and wants a human
    decision, not a test edit.
    """

    def test_due_date_itself_is_in_grace(self):
        assert is_in_grace_period(DUE, DUE) is True

    def test_last_day_of_grace_is_the_day_before_due_plus_grace_days(self):
        assert is_in_grace_period(DUE, day(GRACE_DAYS - 1)) is True

    def test_due_plus_grace_days_is_past_the_window(self):
        assert is_in_grace_period(DUE, day(GRACE_DAYS)) is False


class TestInsideAndOutsideTheWindow:
    @pytest.mark.parametrize("offset", range(1, GRACE_DAYS))
    def test_days_between_due_and_the_end_are_in_grace(self, offset):
        assert is_in_grace_period(DUE, day(offset)) is True

    @pytest.mark.parametrize("offset", [GRACE_DAYS + 1, GRACE_DAYS + 10, 365])
    def test_well_past_the_window_is_not_in_grace(self, offset):
        assert is_in_grace_period(DUE, day(offset)) is False


class TestCalendarArithmetic:
    """Grace windows that straddle awkward calendar boundaries.

    A refactor to ordinal/epoch arithmetic is the likely place for these to
    break, so they are pinned with literal dates rather than timedelta maths.
    """

    def test_window_crosses_a_month_boundary(self):
        due = date(2026, 1, 29)  # January has 31 days
        assert is_in_grace_period(due, date(2026, 1, 31)) is True
        assert is_in_grace_period(due, date(2026, 2, 1)) is True
        assert is_in_grace_period(due, date(2026, 2, 2)) is True
        assert is_in_grace_period(due, date(2026, 2, 3)) is False

    def test_window_crosses_a_year_boundary(self):
        due = date(2025, 12, 29)
        assert is_in_grace_period(due, date(2025, 12, 31)) is True
        assert is_in_grace_period(due, date(2026, 1, 1)) is True
        assert is_in_grace_period(due, date(2026, 1, 2)) is True
        assert is_in_grace_period(due, date(2026, 1, 3)) is False

    def test_window_spans_a_leap_day(self):
        due = date(2028, 2, 26)  # 2028 is a leap year
        assert is_in_grace_period(due, date(2028, 2, 29)) is True
        assert is_in_grace_period(due, date(2028, 3, 1)) is True
        assert is_in_grace_period(due, date(2028, 3, 2)) is False

    def test_window_spans_a_non_leap_february(self):
        due = date(2026, 2, 26)  # 2026 is not a leap year
        assert is_in_grace_period(due, date(2026, 2, 28)) is True
        assert is_in_grace_period(due, date(2026, 3, 1)) is True
        assert is_in_grace_period(due, date(2026, 3, 2)) is True
        assert is_in_grace_period(due, date(2026, 3, 3)) is False

    def test_window_crosses_a_dst_transition(self):
        # Pure date arithmetic must not lose or gain a day across a 23-hour
        # civil day; a refactor via datetime/timestamps could.
        due = date(2026, 3, 6)  # US DST begins 2026-03-08
        assert is_in_grace_period(due, date(2026, 3, 10)) is True
        assert is_in_grace_period(due, date(2026, 3, 11)) is False


class TestReturnContract:
    """The annotated return type is bool, not merely something truthy."""

    @pytest.mark.parametrize("offset", [-1, 0, GRACE_DAYS - 1, GRACE_DAYS])
    def test_returns_an_actual_bool(self, offset):
        assert isinstance(is_in_grace_period(DUE, day(offset)), bool)
