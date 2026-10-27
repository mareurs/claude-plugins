"""Characterization tests for `billing.is_in_grace_period`.

Written to pin down current behaviour ahead of a refactor. The contract under
test, as stated in the module docstring:

  * The grace period is `GRACE_DAYS` days long.
  * An invoice that is not yet due is *not* in its grace period.

Concretely that makes the grace window the half-open day range
`[due, due + GRACE_DAYS)` -- it opens on the due date itself and closes on the
morning of `due + GRACE_DAYS`.

Tests deliberately spell out expected dates as literals where the point is to
pin an exact boundary, and derive them from `GRACE_DAYS` where the point is to
pin the *relationship* to the constant.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period


# A due date with nothing special about it: mid-month, mid-year, non-leap.
DUE = date(2025, 6, 10)


def days_after(d: date, n: int) -> date:
    """`d` shifted by `n` days (negative `n` shifts backwards)."""
    return d + timedelta(days=n)


class TestGraceDaysConstant:
    """Canary for the module constant.

    Several tests below hardcode dates that assume GRACE_DAYS == 5. If that
    constant is retuned, this test fails first and explains the rest.
    """

    def test_grace_days_is_five(self):
        assert GRACE_DAYS == 5

    def test_grace_days_is_a_positive_whole_number_of_days(self):
        assert isinstance(GRACE_DAYS, int)
        assert GRACE_DAYS > 0


class TestNotYetDue:
    """An invoice that has not come due is not in a grace period."""

    def test_day_before_due_is_not_in_grace(self):
        assert is_in_grace_period(DUE, days_after(DUE, -1)) is False

    def test_well_before_due_is_not_in_grace(self):
        assert is_in_grace_period(DUE, days_after(DUE, -30)) is False

    def test_years_before_due_is_not_in_grace(self):
        assert is_in_grace_period(DUE, date(2019, 1, 1)) is False


class TestGraceWindow:
    """The window opens on the due date and runs for GRACE_DAYS days."""

    def test_due_date_itself_is_in_grace(self):
        assert is_in_grace_period(DUE, DUE) is True

    def test_first_day_after_due_is_in_grace(self):
        assert is_in_grace_period(DUE, days_after(DUE, 1)) is True

    def test_last_day_of_grace_is_in_grace(self):
        """`due + GRACE_DAYS - 1` is the final day still covered."""
        assert is_in_grace_period(DUE, days_after(DUE, GRACE_DAYS - 1)) is True

    def test_last_day_of_grace_spelled_out(self):
        # GRACE_DAYS == 5, due 2025-06-10 -> covered through 2025-06-14.
        assert is_in_grace_period(date(2025, 6, 10), date(2025, 6, 14)) is True


class TestGraceExpiry:
    """The window is half-open: it excludes `due + GRACE_DAYS`."""

    def test_day_grace_expires_is_not_in_grace(self):
        assert is_in_grace_period(DUE, days_after(DUE, GRACE_DAYS)) is False

    def test_day_grace_expires_spelled_out(self):
        # GRACE_DAYS == 5, due 2025-06-10 -> expired on 2025-06-15.
        assert is_in_grace_period(date(2025, 6, 10), date(2025, 6, 15)) is False

    def test_well_after_grace_is_not_in_grace(self):
        assert is_in_grace_period(DUE, days_after(DUE, 90)) is False

    def test_years_after_grace_is_not_in_grace(self):
        assert is_in_grace_period(DUE, date(2031, 12, 31)) is False


@pytest.mark.parametrize(
    "offset, expected",
    [
        (-3, False),
        (-2, False),
        (-1, False),  # not yet due
        (0, True),  # due today -- window opens
        (1, True),
        (2, True),
        (3, True),
        (4, True),  # last covered day (GRACE_DAYS - 1)
        (5, False),  # window closes (GRACE_DAYS)
        (6, False),
        (7, False),
    ],
)
def test_offsets_around_due_date(offset, expected):
    """Full truth table either side of the window, assuming GRACE_DAYS == 5."""
    assert is_in_grace_period(DUE, days_after(DUE, offset)) is expected


class TestCalendarArithmetic:
    """The window must span month, year and leap-day boundaries correctly.

    These are the cases most likely to break if day arithmetic is rewritten in
    terms of day-of-month rather than real date deltas.
    """

    @pytest.mark.parametrize(
        "due, today, expected",
        [
            # 30-day month rolling into the next month.
            (date(2025, 4, 28), date(2025, 4, 30), True),
            (date(2025, 4, 28), date(2025, 5, 1), True),
            (date(2025, 4, 28), date(2025, 5, 2), True),  # last covered day
            (date(2025, 4, 28), date(2025, 5, 3), False),  # expired
            # 31-day month rolling into the next month.
            (date(2025, 1, 30), date(2025, 2, 1), True),
            (date(2025, 1, 30), date(2025, 2, 3), True),  # last covered day
            (date(2025, 1, 30), date(2025, 2, 4), False),  # expired
            # Year boundary.
            (date(2025, 12, 29), date(2025, 12, 31), True),
            (date(2025, 12, 29), date(2026, 1, 1), True),
            (date(2025, 12, 29), date(2026, 1, 2), True),  # last covered day
            (date(2025, 12, 29), date(2026, 1, 3), False),  # expired
            # Leap year: window spans 29 Feb.
            (date(2024, 2, 26), date(2024, 2, 29), True),
            (date(2024, 2, 26), date(2024, 3, 1), True),  # last covered day
            (date(2024, 2, 26), date(2024, 3, 2), False),  # expired
            # Non-leap year: same due date, window shifted by the missing day.
            (date(2025, 2, 26), date(2025, 3, 1), True),
            (date(2025, 2, 26), date(2025, 3, 2), True),  # last covered day
            (date(2025, 2, 26), date(2025, 3, 3), False),  # expired
            # Due on 29 Feb itself.
            (date(2024, 2, 29), date(2024, 2, 29), True),
            (date(2024, 2, 29), date(2024, 3, 4), True),  # last covered day
            (date(2024, 2, 29), date(2024, 3, 5), False),  # expired
        ],
    )
    def test_window_crosses_calendar_boundaries(self, due, today, expected):
        assert is_in_grace_period(due, today) is expected

    def test_due_before_boundary_today_after_is_still_not_due(self):
        """Crossing a year boundary backwards is still 'not yet due'."""
        assert is_in_grace_period(date(2026, 1, 2), date(2025, 12, 31)) is False


class TestWindowInvariants:
    """Structural properties that should survive any refactor."""

    @pytest.mark.parametrize(
        "due",
        [
            date(2025, 6, 10),
            date(2024, 2, 26),  # leap-year February
            date(2025, 12, 29),  # year boundary
            date(2025, 1, 31),  # end of a 31-day month
            date(2025, 4, 30),  # end of a 30-day month
        ],
    )
    def test_window_is_exactly_grace_days_long(self, due):
        covered = [
            offset
            for offset in range(-15, 30)
            if is_in_grace_period(due, days_after(due, offset))
        ]
        assert len(covered) == GRACE_DAYS

    @pytest.mark.parametrize(
        "due",
        [date(2025, 6, 10), date(2024, 2, 26), date(2025, 12, 29)],
    )
    def test_window_is_contiguous_and_starts_on_due_date(self, due):
        covered = [
            offset
            for offset in range(-15, 30)
            if is_in_grace_period(due, days_after(due, offset))
        ]
        assert covered == list(range(GRACE_DAYS))

    @pytest.mark.parametrize("year", [2024, 2025])  # leap, non-leap
    def test_exhaustive_sweep_over_a_full_year(self, year):
        """Every due date in `year`, every offset from -2 to +7.

        Guards the whole calendar at once rather than the handful of boundaries
        picked out above.
        """
        due = date(year, 1, 1)
        end = date(year + 1, 1, 1)
        while due < end:
            for offset in range(-2, 8):
                expected = 0 <= offset < GRACE_DAYS
                actual = is_in_grace_period(due, days_after(due, offset))
                assert actual is expected, (
                    f"due={due} offset={offset}: expected {expected}, got {actual}"
                )
            due += timedelta(days=1)


class TestGraceDaysIsHonouredAtCallTime:
    """The constant should be the single source of truth for window length.

    This pins a contract rather than current line-level behaviour: retuning
    `GRACE_DAYS` must change the window. A refactor that freezes the value at
    import time (e.g. captures it in a default argument) will fail here.
    """

    @pytest.mark.parametrize("grace", [1, 2, 10, 30])
    def test_window_length_follows_the_constant(self, monkeypatch, grace):
        monkeypatch.setattr("billing.GRACE_DAYS", grace)
        covered = [
            offset
            for offset in range(-5, 40)
            if is_in_grace_period(DUE, days_after(DUE, offset))
        ]
        assert covered == list(range(grace))

    def test_zero_grace_days_covers_nothing(self, monkeypatch):
        monkeypatch.setattr("billing.GRACE_DAYS", 0)
        covered = [
            offset
            for offset in range(-5, 10)
            if is_in_grace_period(DUE, days_after(DUE, offset))
        ]
        assert covered == []


class TestExtremeDates:
    """Behaviour at the edges of the representable date range."""

    def test_earliest_representable_due_date(self):
        assert is_in_grace_period(date.min, date.min) is True
        assert is_in_grace_period(date.min, days_after(date.min, GRACE_DAYS)) is False

    @pytest.mark.xfail(
        raises=OverflowError,
        reason=(
            "Known wart: `due + timedelta(days=GRACE_DAYS)` overflows when `due` "
            "is near date.max, even though the answer (True -- it is day 0 of the "
            "grace period) needs no arithmetic past date.max. Recorded, not "
            "endorsed; a refactor that computes `(today - due).days` instead would "
            "fix this and XPASS here."
        ),
        strict=False,
    )
    def test_latest_representable_due_date(self):
        assert is_in_grace_period(date.max, date.max) is True
