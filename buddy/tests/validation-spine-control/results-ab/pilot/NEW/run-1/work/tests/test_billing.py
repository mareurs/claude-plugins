"""Tests for `billing.is_in_grace_period`.

Expectations here are derived from the function's documented contract, not from
what the current implementation returns:

  - "The grace period is GRACE_DAYS days long."
  - "An invoice that is not yet due is not in its grace period."

Read together, those fix both ends of the window: it opens on the due date
itself (the invoice has fallen due, so the second sentence does not exclude it)
and spans GRACE_DAYS days in total. The last day inside is therefore
`due + GRACE_DAYS - 1`, and `due + GRACE_DAYS` is the first day outside.
"""

from datetime import date, timedelta

import pytest

import billing
from billing import GRACE_DAYS, is_in_grace_period

DUE = date(2026, 6, 10)


# --- The window, relative to the due date ---------------------------------


def test_day_the_invoice_falls_due_is_in_grace():
    """The invoice has fallen due, so the "not yet due" carve-out doesn't apply."""
    assert is_in_grace_period(DUE, DUE) is True


def test_day_before_due_is_not_in_grace():
    """Not yet due."""
    assert is_in_grace_period(DUE, DUE - timedelta(days=1)) is False


def test_long_before_due_is_not_in_grace():
    assert is_in_grace_period(DUE, DUE - timedelta(days=90)) is False


def test_last_day_of_the_window_is_in_grace():
    """Window is GRACE_DAYS long counting the due date, so it ends GRACE_DAYS-1 later."""
    last_day = DUE + timedelta(days=GRACE_DAYS - 1)
    assert is_in_grace_period(DUE, last_day) is True


def test_day_after_the_window_is_not_in_grace():
    """`due + GRACE_DAYS` is the first day past a GRACE_DAYS-long window."""
    first_day_out = DUE + timedelta(days=GRACE_DAYS)
    assert is_in_grace_period(DUE, first_day_out) is False


def test_long_after_due_is_not_in_grace():
    assert is_in_grace_period(DUE, DUE + timedelta(days=90)) is False


@pytest.mark.parametrize("offset", range(-3, GRACE_DAYS + 4))
def test_window_membership_across_the_whole_span(offset):
    """Every day from well before due to well after, in one sweep."""
    expected = 0 <= offset < GRACE_DAYS
    assert is_in_grace_period(DUE, DUE + timedelta(days=offset)) is expected


def test_window_covers_exactly_grace_days_days():
    """Counting, rather than probing, that the window is GRACE_DAYS long."""
    in_grace = [
        offset
        for offset in range(-30, 31)
        if is_in_grace_period(DUE, DUE + timedelta(days=offset))
    ]
    assert len(in_grace) == GRACE_DAYS
    assert in_grace == list(range(GRACE_DAYS))


# --- GRACE_DAYS is the knob, not a hardcoded 5 ----------------------------


@pytest.mark.parametrize("grace", [1, 3, 7, 30])
def test_boundaries_follow_the_configured_grace_days(monkeypatch, grace):
    """Changing GRACE_DAYS must move both ends of the window with it."""
    monkeypatch.setattr(billing, "GRACE_DAYS", grace)

    assert billing.is_in_grace_period(DUE, DUE) is True
    assert billing.is_in_grace_period(DUE, DUE + timedelta(days=grace - 1)) is True
    assert billing.is_in_grace_period(DUE, DUE + timedelta(days=grace)) is False


# --- Real calendar arithmetic ---------------------------------------------
# These would pass under naive day-field arithmetic only by accident; they pin
# the behaviour against a refactor that stops using timedelta.


def test_window_spans_a_month_boundary():
    """Due Jan 30 with a 5-day window runs into February."""
    due = date(2026, 1, 30)
    assert is_in_grace_period(due, date(2026, 2, 3)) is True  # due + 4
    assert is_in_grace_period(due, date(2026, 2, 4)) is False  # due + 5


def test_window_spans_a_year_boundary():
    """Due Dec 29 with a 5-day window runs into the next year."""
    due = date(2025, 12, 29)
    assert is_in_grace_period(due, date(2026, 1, 2)) is True  # due + 4
    assert is_in_grace_period(due, date(2026, 1, 3)) is False  # due + 5


def test_window_spans_a_leap_day():
    """2028 is a leap year, so Feb 29 is a real day inside this window."""
    due = date(2028, 2, 26)
    assert is_in_grace_period(due, date(2028, 2, 29)) is True  # due + 3
    assert is_in_grace_period(due, date(2028, 3, 1)) is True  # due + 4
    assert is_in_grace_period(due, date(2028, 3, 2)) is False  # due + 5


def test_window_skips_the_absent_leap_day_in_a_common_year():
    """2026 has no Feb 29, so the same due date lands a day earlier in March."""
    due = date(2026, 2, 26)
    assert is_in_grace_period(due, date(2026, 2, 28)) is True  # due + 2
    assert is_in_grace_period(due, date(2026, 3, 1)) is True  # due + 3
    assert is_in_grace_period(due, date(2026, 3, 2)) is True  # due + 4
    assert is_in_grace_period(due, date(2026, 3, 3)) is False  # due + 5


# --- Shipped default -------------------------------------------------------


def test_shipped_grace_days_default():
    """Pins the configured default so a refactor can't silently change it."""
    assert GRACE_DAYS == 5
