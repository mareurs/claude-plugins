"""Characterisation tests for src/billing.py, written against the docstring contract.

Contract (from the docstring, not from the implementation):
    is_in_grace_period(due, today) -> bool is pure and returns True exactly when
    `today` falls inside the GRACE_DAYS-long window that opens on the due date.
    An invoice that is not yet due is never in its grace period.

Two readings the docstring pins down, and which these tests therefore enforce:
  * "not yet due is not in its grace period" means an invoice due *today* IS in
    grace -- it is due, not "not yet due". So offset 0 is True.
  * "the grace period is GRACE_DAYS days long", opening on `due`, means it covers
    the days due .. due + GRACE_DAYS - 1. So offset GRACE_DAYS is the first day out.
"""

from datetime import date, timedelta

import pytest

import billing
from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 6, 10)


def test_invoice_due_today_is_in_grace():
    """Offset 0: due, not 'not yet due', so it is in grace."""
    assert is_in_grace_period(DUE, DUE)


def test_last_day_of_grace_period_is_in_grace():
    """A GRACE_DAYS-long window opening on `due` still covers due + GRACE_DAYS - 1."""
    assert is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS - 1))


def test_first_day_after_grace_period_is_not_in_grace():
    """The window is GRACE_DAYS days long, so due + GRACE_DAYS is already outside."""
    assert not is_in_grace_period(DUE, DUE + timedelta(days=GRACE_DAYS))


@pytest.mark.parametrize("days_early", [1, 2, 5, 30, 365])
def test_invoice_not_yet_due_is_not_in_grace(days_early):
    assert not is_in_grace_period(DUE, DUE - timedelta(days=days_early))


@pytest.mark.parametrize("days_late", [1, 2, 30, 365])
def test_long_overdue_invoice_is_not_in_grace(days_late):
    today = DUE + timedelta(days=GRACE_DAYS + days_late)
    assert not is_in_grace_period(DUE, today)


def test_grace_period_is_exactly_grace_days_long():
    """Sweep a wide window: the True days are precisely offsets 0 .. GRACE_DAYS - 1.

    This is the anti-off-by-one net. Any shift or resize of either bound moves the
    returned set and fails here, even if the single-point tests above were edited.
    """
    in_grace = {
        offset
        for offset in range(-10, 21)
        if is_in_grace_period(DUE, DUE + timedelta(days=offset))
    }

    assert in_grace == set(range(0, GRACE_DAYS))


def test_grace_window_honours_the_grace_days_constant(monkeypatch):
    """The length comes from GRACE_DAYS, not from a hardcoded number.

    NOTE for the refactor: this test reads GRACE_DAYS at *call* time. If you move
    the constant into a default argument (`grace_days=GRACE_DAYS`) or a config
    object, this will fail even though behaviour at the real constant is unchanged.
    That failure is a binding change, not a regression -- retarget the test.
    """
    monkeypatch.setattr(billing, "GRACE_DAYS", 3)

    assert billing.is_in_grace_period(DUE, DUE + timedelta(days=2))
    assert not billing.is_in_grace_period(DUE, DUE + timedelta(days=3))


@pytest.mark.parametrize(
    "due, last_in_grace, first_out_of_grace",
    [
        # Expected dates are literals on purpose: the test must not reach its
        # verdict through the same timedelta arithmetic it is checking.
        pytest.param(
            date(2026, 1, 31), date(2026, 2, 4), date(2026, 2, 5), id="month-end"
        ),
        pytest.param(
            date(2026, 12, 29), date(2027, 1, 2), date(2027, 1, 3), id="year-end"
        ),
        pytest.param(
            date(2028, 2, 26), date(2028, 3, 1), date(2028, 3, 2), id="leap-february"
        ),
        pytest.param(
            date(2027, 2, 26), date(2027, 3, 2), date(2027, 3, 3), id="common-february"
        ),
    ],
)
def test_grace_period_crosses_calendar_boundaries(due, last_in_grace, first_out_of_grace):
    """Guards against a refactor to naive day arithmetic (e.g. due.day + GRACE_DAYS)."""
    assert is_in_grace_period(due, last_in_grace)
    assert not is_in_grace_period(due, first_out_of_grace)


def test_returns_an_actual_bool():
    """The docstring promises bool, so callers may serialise or identity-check it."""
    assert is_in_grace_period(DUE, DUE) is True
    assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


# Deliberately absent: a "does not mutate its arguments" test. datetime.date is
# immutable, so no change to the function body could ever make such a test fail.
# It would read as coverage while being incapable of reporting a regression.
