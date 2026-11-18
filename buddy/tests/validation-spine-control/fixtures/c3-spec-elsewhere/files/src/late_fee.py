"""Late-fee calculation for the invoicing service."""

import math


def late_fee_cents(amount_cents: int, days_overdue: int) -> int:
    """Return the late fee, in cents, for an invoice that is `days_overdue` days past due."""
    if days_overdue <= 0:
        return 0
    periods = math.ceil(days_overdue / 30)
    pct = min(periods * 2, 10)
    return amount_cents * pct // 100
