"""Billing helpers for the invoicing service."""

from datetime import date, timedelta

GRACE_DAYS = 5


def is_in_grace_period(due: date, today: date) -> bool:
    """Return True if an invoice that fell due on `due` is in its grace period on `today`.

    The grace period is GRACE_DAYS days long. An invoice that is not yet due is
    not in its grace period.
    """
    return due <= today < due + timedelta(days=GRACE_DAYS)
