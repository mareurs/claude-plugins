"""Tests for billing.is_in_grace_period.

Expectations here are derived from the function's docstring, not from its current
implementation:

  1. The grace period is GRACE_DAYS days long.
  2. An invoice that is not yet due is not in its grace period.

(1) and (2) together pin the window down completely: the grace period cannot start
before the due date, and an invoice must be in grace on the day it falls due (nothing
else would make the period contiguous and GRACE_DAYS long), so the window is the
GRACE_DAYS days `due .. due + GRACE_DAYS - 1` and `due + GRACE_DAYS` is outside it.

Boundary values are written in terms of GRACE_DAYS rather than the literal 5, so that
changing the constant moves the tests with the spec instead of breaking them.
"""

from datetime import date, timedelta

import pytest

from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 3, 10)


# --- Not yet due -----------------------------------------------------------------
# Docstring: "An invoice that is not yet due is not in its grace period."


@pytest.mark.parametrize("days_early", [1, 2, GRACE_DAYS, 30, 365])
def test_invoice_not_yet_due_is_not_in_grace(days_early):
    assert is_in_grace_period(DUE, DUE - timedelta(days=days_early)) is False


# --- Inside the window -----------------------------------------------------------


def test_due_date_itself_is_in_grace():
    """The first day of the window. Red if the lower bound becomes exclusive."""
    assert is_in_grace_period(DUE, DUE) is True


@pytest.mark.parametrize("offset", range(GRACE_DAYS))
def test_every_day_of_the_window_is_in_grace(offset):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is True


def test_last_day_of_grace():
    """Red if GRACE_DAYS shrinks or the window slides."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS - 1)) is True


# --- Outside the window ----------------------------------------------------------


def test_day_after_grace_expires():
    """The first day outside the window. Red if the upper bound becomes inclusive."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS)) is False


@pytest.mark.parametrize("days_late", [GRACE_DAYS + 1, GRACE_DAYS + 30, 365])
def test_long_overdue_is_not_in_grace(days_late):
    assert is_in_grace_period(DUE, DUE + timedelta(days=days_late)) is False


# --- The window is exactly GRACE_DAYS long ---------------------------------------


def test_grace_period_spans_exactly_grace_days():
    """Independent of where the window starts: it must contain GRACE_DAYS days.

    Red if either bound moves, if GRACE_DAYS is misapplied, or if the window
    becomes discontiguous.
    """
    window = [
        DUE + timedelta(days=offset)
        for offset in range(-GRACE_DAYS * 2, GRACE_DAYS * 3)
        if is_in_grace_period(DUE, DUE + timedelta(days=offset))
    ]
    assert len(window) == GRACE_DAYS
    assert window[0] == DUE
    assert window[-1] == DUE + timedelta(days=GRACE_DAYS - 1)


# --- The constant itself ---------------------------------------------------------
# Every boundary above is written in terms of GRACE_DAYS, which makes those tests
# blind to a change in the constant: they would slide along with it and stay green.
# These two pin the policy value in absolute terms.


def test_grace_days_is_five():
    """The configured policy. Red if the constant is changed."""
    assert GRACE_DAYS == 5


def test_window_in_concrete_dates():
    """The same window stated without reference to GRACE_DAYS.

    An invoice due Tue 10 Mar 2026 is in grace through Sat 14 Mar and overdue on
    Sun 15 Mar.
    """
    assert is_in_grace_period(date(2026, 3, 10), date(2026, 3, 9)) is False
    assert is_in_grace_period(date(2026, 3, 10), date(2026, 3, 10)) is True
    assert is_in_grace_period(date(2026, 3, 10), date(2026, 3, 14)) is True
    assert is_in_grace_period(date(2026, 3, 10), date(2026, 3, 15)) is False


# --- Calendar arithmetic ---------------------------------------------------------
# A refactor that reaches for day-of-month arithmetic instead of timedelta passes
# every test above and fails these.


@pytest.mark.parametrize(
    "due",
    [
        pytest.param(date(2026, 1, 29), id="into-february"),
        pytest.param(date(2026, 4, 28), id="across-30-day-month-end"),
        pytest.param(date(2026, 12, 29), id="across-new-year"),
        pytest.param(date(2024, 2, 26), id="across-leap-day"),
        pytest.param(date(2026, 2, 26), id="across-non-leap-february"),
    ],
)
def test_window_crosses_month_and_year_boundaries(due):
    assert is_in_grace_period(due, due + timedelta(days=GRACE_DAYS - 1)) is True
    assert is_in_grace_period(due, due + timedelta(days=GRACE_DAYS)) is False


# --- Argument handling -----------------------------------------------------------


def test_arguments_are_not_interchangeable():
    """`due` and `today` are distinct roles; swapping them must change the answer.

    Red if a refactor compares with abs() or otherwise loses the direction of time.
    """
    today = DUE + timedelta(days=1)
    assert is_in_grace_period(DUE, today) is True
    assert is_in_grace_period(today, DUE) is False


def test_does_not_mutate_its_arguments():
    due, today = date(2026, 3, 10), date(2026, 3, 12)
    is_in_grace_period(due, today)
    assert (due, today) == (date(2026, 3, 10), date(2026, 3, 12))


def test_datetime_argument_raises():
    """Unspecified by the docstring — recorded, not required.

    `datetime` subclasses `date`, so a caller can reach this function with one by
    accident. Python refuses to order a `date` against a `datetime`, so today the
    call raises TypeError rather than guessing. The docstring takes no position on
    this; the test pins the current behaviour so that a refactor which starts
    accepting datetimes (e.g. by normalising inputs) surfaces that as a decision to
    document rather than a silent change in meaning at the boundary.
    """
    from datetime import datetime

    with pytest.raises(TypeError):
        is_in_grace_period(DUE, datetime(2026, 3, 10, 12, 0))
