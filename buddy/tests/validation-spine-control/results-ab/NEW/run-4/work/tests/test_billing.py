"""Tests for src/billing.py.

Expectations here are derived from the docstring of `is_in_grace_period`, not
from what the implementation currently returns:

    Return True if an invoice that fell due on `due` is in its grace period on
    `today`. The grace period is GRACE_DAYS days long. An invoice that is not
    yet due is not in its grace period.

Three rules follow from that text:

  R1  `today` before `due`  -> False                  ("not yet due")
  R2  the `today` values that return True are contiguous   (it is a *period*)
  R3  there are exactly GRACE_DAYS of them             ("GRACE_DAYS days long")

What the docstring does *not* settle is which end of the window is closed: a
five-day grace period starting on the due date (offsets 0..4) and one starting
the day after (offsets 1..5) both satisfy R1-R3. So the two endpoint days --
`due` itself and `due + GRACE_DAYS` -- are not asserted against the spec here.
They are pinned separately at the bottom of this file as characterization
tests, which say "this is what the code does today" rather than "this is what
the code should do".

Everything strictly between those endpoints is unambiguous and is tested
normally.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

# A spread of due dates, so no test depends on one magic day: mid-month, a
# month end, a year end, and a window that runs through a leap day.
DUE_DATES = [
    pytest.param(date(2026, 6, 15), id="mid-month"),
    pytest.param(date(2026, 1, 31), id="month-end"),
    pytest.param(date(2025, 12, 30), id="year-end"),
    pytest.param(date(2028, 2, 27), id="leap-day"),
    pytest.param(date(2027, 2, 26), id="non-leap-february"),
]

# Wide enough to contain the whole window plus slack on both sides.
SCAN = range(-60, 61)


def grace_offsets(due):
    """Day offsets from `due` on which the invoice reads as in its grace period."""
    return [n for n in SCAN if is_in_grace_period(due, due + timedelta(days=n))]


# --------------------------------------------------------------------------
# R1: an invoice that is not yet due is not in its grace period.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("due", DUE_DATES)
@pytest.mark.parametrize("days_early", [1, 2, 4, 5, 6, 30, 365])
def test_before_due_date_is_not_in_grace_period(due, days_early):
    assert is_in_grace_period(due, due - timedelta(days=days_early)) is False


@pytest.mark.parametrize("due", DUE_DATES)
def test_grace_period_never_starts_before_the_due_date(due):
    offsets = grace_offsets(due)
    assert offsets, "no day at all reads as in the grace period"
    assert offsets[0] >= 0


# --------------------------------------------------------------------------
# R2 + R3: a contiguous period, GRACE_DAYS days long.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("due", DUE_DATES)
def test_grace_period_is_exactly_grace_days_long(due):
    assert len(grace_offsets(due)) == GRACE_DAYS


@pytest.mark.parametrize("due", DUE_DATES)
def test_grace_period_is_an_unbroken_run_of_days(due):
    offsets = grace_offsets(due)
    assert offsets == list(range(offsets[0], offsets[0] + len(offsets)))


# --------------------------------------------------------------------------
# Days whose answer both readings of the docstring agree on.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("due", DUE_DATES)
@pytest.mark.parametrize("days_after", range(1, GRACE_DAYS))
def test_days_inside_the_window_are_in_grace_period(due, days_after):
    """Offsets 1..GRACE_DAYS-1 are inside the window under either reading."""
    assert is_in_grace_period(due, due + timedelta(days=days_after)) is True


@pytest.mark.parametrize("due", DUE_DATES)
@pytest.mark.parametrize("extra", [1, 2, 10, 30, 365])
def test_days_past_the_window_are_not_in_grace_period(due, extra):
    """Offsets GRACE_DAYS+1 and beyond are outside under either reading."""
    today = due + timedelta(days=GRACE_DAYS + extra)
    assert is_in_grace_period(due, today) is False


# --------------------------------------------------------------------------
# Calendar arithmetic: the window is counted in real days, not day-of-month.
# All cases below use interior offsets, so they hold under either reading.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("due", "today", "expected"),
    [
        # Feb 27 2028 + 2 days: 2028 is a leap year, so this lands on Feb 29.
        pytest.param(date(2028, 2, 27), date(2028, 2, 29), True, id="leap-day-inside"),
        # Feb 27 2028 + 3 days crosses into March.
        pytest.param(date(2028, 2, 27), date(2028, 3, 1), True, id="leap-into-march"),
        # 2027 is not a leap year: Feb 26 + 3 days is Mar 1, not Feb 29.
        pytest.param(date(2027, 2, 26), date(2027, 3, 1), True, id="non-leap-into-march"),
        # Across a year boundary.
        pytest.param(date(2025, 12, 30), date(2026, 1, 2), True, id="into-new-year"),
        # Across a year boundary, but past the window.
        pytest.param(date(2025, 12, 30), date(2026, 1, 10), False, id="new-year-too-late"),
        # Same calendar day number, one month later: far outside the window.
        pytest.param(date(2026, 6, 15), date(2026, 7, 15), False, id="next-month"),
    ],
)
def test_window_crosses_month_and_year_boundaries(due, today, expected):
    assert is_in_grace_period(due, today) is expected


# --------------------------------------------------------------------------
# Type contract.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("offset", [-10, -1, 1, 2, 10, 400])
def test_returns_a_real_bool(offset):
    """The annotation says `-> bool`; callers may be serialising this."""
    due = date(2026, 6, 15)
    assert isinstance(is_in_grace_period(due, due + timedelta(days=offset)), bool)


# --------------------------------------------------------------------------
# Characterization. NOT derived from the docstring.
#
# These pin behaviour the docstring leaves open. If a refactor turns one of
# these red, that is not automatically a bug -- it is a question: did you mean
# to move the window? Answer it, then either fix the code or update both the
# docstring and the test together.
# --------------------------------------------------------------------------


@pytest.mark.characterization
@pytest.mark.parametrize("due", DUE_DATES)
def test_characterization_due_date_itself_counts_as_grace(due):
    """Today the window is [due, due + GRACE_DAYS): the due date is day one."""
    assert is_in_grace_period(due, due) is True


@pytest.mark.characterization
@pytest.mark.parametrize("due", DUE_DATES)
def test_characterization_day_grace_days_after_due_is_excluded(due):
    """Today `due + GRACE_DAYS` is the first day *past* the window."""
    assert is_in_grace_period(due, due + timedelta(days=GRACE_DAYS)) is False


@pytest.mark.characterization
def test_characterization_grace_period_is_five_days():
    """The length tests follow GRACE_DAYS, so its value is pinned separately."""
    assert GRACE_DAYS == 5
