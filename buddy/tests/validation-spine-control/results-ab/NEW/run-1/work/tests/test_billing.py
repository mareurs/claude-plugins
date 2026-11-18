"""Tests for src/billing.py.

Expectations here are derived from the docstring of `is_in_grace_period`, not from
reading its implementation:

    "Return True if an invoice that fell due on `due` is in its grace period on
     `today`. The grace period is GRACE_DAYS days long. An invoice that is not yet
     due is not in its grace period."

Two readings have to be fixed to write any boundary assertion at all:

1. The due date itself counts as in-grace. The docstring names exactly one
   exclusion -- "not yet due" -- and on `due` the invoice *is* due, so it is not
   excluded. The window therefore opens at `due`.
2. "GRACE_DAYS days long", with the window opening at `due`, makes the in-grace
   days {due, due+1, ..., due+GRACE_DAYS-1} and `due + GRACE_DAYS` the first day
   out. The competing convention -- GRACE_DAYS days *after* the due date, making
   `due + GRACE_DAYS` the last in-grace day -- would shift both edges by one.

Reading 2 is the thin spot; see test_last_day_in_grace_period / test_first_day_after_grace_period.
"""

from datetime import date, timedelta

import pytest

import billing
from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 6, 10)


def test_grace_days_is_five():
    """Guard for the hardcoded offsets below.

    The per-day cases in this module spell out concrete expectations for
    GRACE_DAYS == 5. If the constant is retuned, this fails once and explains the
    cascade instead of leaving a dozen opaque red tests.
    """
    assert GRACE_DAYS == 5


# --- the window, day by day -------------------------------------------------


@pytest.mark.parametrize("offset", [0, 1, 2, 3, 4])
def test_days_within_grace_period(offset):
    """due .. due+4 are the five days of grace."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is True


@pytest.mark.parametrize("offset", [-30, -7, -2, -1])
def test_invoice_not_yet_due_is_not_in_grace_period(offset):
    """Explicit in the docstring: not yet due => not in grace."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False


@pytest.mark.parametrize("offset", [5, 6, 30, 365])
def test_days_after_grace_period_expired(offset):
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is False


# --- the three edges, called out individually -------------------------------


def test_due_date_itself_is_in_grace_period():
    """Opening edge: `today == due`. Reading 1 above."""
    assert is_in_grace_period(DUE, DUE) is True


def test_day_before_due_is_not_in_grace_period():
    """Opening edge, outer side -- the docstring's one explicit exclusion."""
    assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


def test_last_day_in_grace_period():
    """Closing edge, inner side: due + GRACE_DAYS - 1 is still in grace."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS - 1)) is True


def test_first_day_after_grace_period():
    """Closing edge, outer side: due + GRACE_DAYS has fallen out.

    This is the assertion that flips under the competing convention in the module
    docstring. If the refactor intends "GRACE_DAYS days after the due date", this
    test and test_last_day_in_grace_period are the two to revisit -- deliberately,
    not by deleting them.
    """
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS)) is False


def test_grace_window_is_exactly_grace_days_long():
    """The whole contract in one assertion, independent of where DUE sits."""
    in_grace = [
        DUE + timedelta(days=n)
        for n in range(-GRACE_DAYS, 2 * GRACE_DAYS + 1)
        if is_in_grace_period(DUE, DUE + timedelta(days=n))
    ]
    assert in_grace == [DUE + timedelta(days=n) for n in range(GRACE_DAYS)]


def test_length_follows_the_grace_days_constant(monkeypatch):
    """The docstring states the length *in terms of* GRACE_DAYS.

    A function that hardcoded 5 would be indistinguishable from one that reads the
    constant under every other test here, so this one pins the dependency.

    Implementation-coupled on purpose: it assumes the constant is read at call
    time. A refactor to `is_in_grace_period(due, today, grace_days=GRACE_DAYS)` is
    still faithful to the docstring -- rewrite this test to pass the argument
    rather than dropping it.
    """
    monkeypatch.setattr(billing, "GRACE_DAYS", 2)

    assert billing.is_in_grace_period(DUE, DUE + timedelta(days=1)) is True
    assert billing.is_in_grace_period(DUE, DUE + timedelta(days=2)) is False


# --- calendar arithmetic ----------------------------------------------------


def test_grace_period_spans_month_boundary():
    due = date(2026, 1, 30)
    assert is_in_grace_period(due, date(2026, 2, 3)) is True   # due+4
    assert is_in_grace_period(due, date(2026, 2, 4)) is False  # due+5


def test_grace_period_spans_year_boundary():
    due = date(2026, 12, 29)
    assert is_in_grace_period(due, date(2027, 1, 2)) is True   # due+4
    assert is_in_grace_period(due, date(2027, 1, 3)) is False  # due+5


def test_grace_period_spans_leap_day():
    """2028 is a leap year: Feb 26 + 4 days lands on Mar 1."""
    due = date(2028, 2, 26)
    assert is_in_grace_period(due, date(2028, 2, 29)) is True  # due+3
    assert is_in_grace_period(due, date(2028, 3, 1)) is True   # due+4
    assert is_in_grace_period(due, date(2028, 3, 2)) is False  # due+5


def test_grace_period_in_non_leap_year():
    """Same calendar dates, no Feb 29: Mar 1 is only due+3 and Mar 2 still in grace."""
    due = date(2026, 2, 26)
    assert is_in_grace_period(due, date(2026, 3, 2)) is True   # due+4
    assert is_in_grace_period(due, date(2026, 3, 3)) is False  # due+5


def test_grace_period_at_date_min():
    """No underflow computing the lower bound at the start of the calendar."""
    assert is_in_grace_period(date.min, date.min) is True
    assert is_in_grace_period(date.min, date.min + timedelta(days=GRACE_DAYS)) is False


def test_date_max_due_does_not_overflow():
    """due + GRACE_DAYS is unrepresentable at the end of the calendar.

    Unspecified by the docstring. Pinned as "raises OverflowError" only because
    that is what any timedelta-based implementation must do; if the refactor
    chooses to clamp or return False instead, that is a deliberate change of
    contract, not a regression.
    """
    with pytest.raises(OverflowError):
        is_in_grace_period(date.max, date.max)


# --- unspecified, deliberately not asserted ---------------------------------
#
# * `datetime` passed where a `date` is declared. date/datetime comparison raises
#   TypeError, but the type contract says `date`, so no behaviour is owed here.
# * `due` and `today` arriving in either order is fully covered above -- there is
#   no separate "today before due" contract beyond the not-yet-due rule.
