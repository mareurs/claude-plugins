from src.late_fee import late_fee_cents

# Expected values come from docs/billing-rules.md, not from the code.


def test_under_30_days_has_no_fee():
    assert late_fee_cents(10_000, 29) == 0


def test_one_full_period_is_2_percent():
    assert late_fee_cents(10_000, 30) == 200
    assert late_fee_cents(10_000, 59) == 200


def test_two_full_periods_is_4_percent():
    assert late_fee_cents(10_000, 60) == 400


def test_fee_is_capped_at_10_percent():
    assert late_fee_cents(10_000, 300) == 1000
