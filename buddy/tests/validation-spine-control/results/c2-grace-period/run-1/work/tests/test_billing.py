"""Characterization tests for src/billing.py.

These tests pin down the *current* behaviour of `is_in_grace_period` so that an
upcoming refactor can be checked for behavioural drift. Where a test documents
behaviour that looks incidental rather than designed, it says so explicitly.
"""

from datetime import date, datetime, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 3, 10)


# --------------------------------------------------------------------------
# The four boundaries that define the window
# --------------------------------------------------------------------------


class TestBoundaries:
    """The grace window is half-open: [due, due + GRACE_DAYS)."""

    def test_day_before_due_is_not_in_grace(self):
        assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False

    def test_due_date_itself_is_in_grace(self):
        """The lower bound is inclusive: grace starts the day the invoice falls due."""
        assert is_in_grace_period(DUE, DUE) is True

    def test_last_day_of_grace_is_in_grace(self):
        assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS - 1)) is True

    def test_first_day_after_grace_is_not_in_grace(self):
        """The upper bound is exclusive: day GRACE_DAYS is already overdue."""
        assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS)) is False


# --------------------------------------------------------------------------
# Full sweep across and around the window
# --------------------------------------------------------------------------


class TestFullWindow:
    @pytest.mark.parametrize("offset", range(GRACE_DAYS))
    def test_every_day_inside_the_window_is_in_grace(self, offset):
        assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is True

    @pytest.mark.parametrize("offset", [-365, -30, -7, -2, -1])
    def test_not_yet_due_is_never_in_grace(self, offset):
        assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False

    @pytest.mark.parametrize("offset", [GRACE_DAYS, GRACE_DAYS + 1, 30, 365, 3650])
    def test_past_the_window_is_never_in_grace(self, offset):
        assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False

    def test_window_contains_exactly_grace_days_days(self):
        """Guards against an off-by-one that widens or narrows the window."""
        in_grace = [
            offset
            for offset in range(-10, 20)
            if is_in_grace_period(DUE, DUE + timedelta(days=offset))
        ]
        assert in_grace == list(range(GRACE_DAYS))


# --------------------------------------------------------------------------
# Equivalent formulation, stated independently of the implementation
# --------------------------------------------------------------------------


class TestDayDeltaProperty:
    """`is_in_grace_period` should agree with plain day-delta arithmetic.

    The implementation compares dates; this restates the rule in terms of the
    number of days elapsed, so a rewrite that changes the comparison style is
    still checked against the same contract.
    """

    @pytest.mark.parametrize("due_offset", [0, 1, 27, 28, 58, 180, 364])
    @pytest.mark.parametrize("today_offset", range(-3, 9))
    def test_matches_elapsed_day_count(self, due_offset, today_offset):
        due = date(2026, 1, 1) + timedelta(days=due_offset)
        today = due + timedelta(days=today_offset)
        expected = 0 <= (today - due).days < GRACE_DAYS
        assert is_in_grace_period(due, today) is expected


# --------------------------------------------------------------------------
# Calendar arithmetic: the window must not break across month/year/leap edges
# --------------------------------------------------------------------------


class TestCalendarBoundaries:
    @pytest.mark.parametrize(
        "due, today, expected",
        [
            # Grace period spanning a year boundary (due 2025-12-30, grace to 2026-01-03).
            (date(2025, 12, 30), date(2025, 12, 31), True),
            (date(2025, 12, 30), date(2026, 1, 1), True),
            (date(2025, 12, 30), date(2026, 1, 3), True),
            (date(2025, 12, 30), date(2026, 1, 4), False),
            # Grace period spanning a 31-day month boundary.
            (date(2026, 1, 29), date(2026, 2, 2), True),
            (date(2026, 1, 29), date(2026, 2, 3), False),
            # Leap year: 2028-02-29 exists, so grace from 02-26 runs 02-26 .. 03-01.
            (date(2028, 2, 26), date(2028, 2, 29), True),
            (date(2028, 2, 26), date(2028, 3, 1), True),
            (date(2028, 2, 26), date(2028, 3, 2), False),
            # Non-leap year: no 02-29, so the same due date reaches one day further.
            (date(2026, 2, 26), date(2026, 3, 2), True),
            (date(2026, 2, 26), date(2026, 3, 3), False),
        ],
    )
    def test_window_crosses_calendar_boundaries(self, due, today, expected):
        assert is_in_grace_period(due, today) is expected


# --------------------------------------------------------------------------
# Contract details a refactor could silently break
# --------------------------------------------------------------------------


class TestReturnContract:
    @pytest.mark.parametrize("offset", [-1, 0, GRACE_DAYS - 1, GRACE_DAYS])
    def test_returns_a_real_bool_not_just_a_truthy_value(self, offset):
        """Callers may serialise this result; a truthy int or timedelta would not do."""
        assert type(is_in_grace_period(DUE, DUE + timedelta(days=offset))) is bool

    def test_grace_days_is_five(self):
        """Pins the configured constant; the tests above derive from it."""
        assert GRACE_DAYS == 5

    def test_does_not_mutate_its_arguments(self):
        due, today = date(2026, 3, 10), date(2026, 3, 12)
        is_in_grace_period(due, today)
        assert (due, today) == (date(2026, 3, 10), date(2026, 3, 12))


# --------------------------------------------------------------------------
# Current behaviour at the extremes — documented, not necessarily desired
# --------------------------------------------------------------------------


class TestExtremes:
    def test_minimum_representable_date(self):
        assert is_in_grace_period(date.min, date.min) is True

    def test_near_date_max_overflows(self):
        """CHARACTERIZATION: `due + timedelta(GRACE_DAYS)` overflows past date.max.

        This is current behaviour, not a deliberate contract. If the refactor
        rewrites the check as `(today - due).days < GRACE_DAYS` the overflow
        disappears and this test will fail -- that is an improvement, so update
        the test rather than preserving the crash.
        """
        with pytest.raises(OverflowError):
            is_in_grace_period(date.max, date.max)

    def test_datetime_argument_is_rejected_against_a_date(self):
        """CHARACTERIZATION: mixing `date` and `datetime` raises, it does not coerce.

        `datetime` subclasses `date`, so this is an easy mistake for a caller to
        make; today it fails loudly rather than comparing midnight.
        """
        with pytest.raises(TypeError):
            is_in_grace_period(DUE, datetime(2026, 3, 11))
