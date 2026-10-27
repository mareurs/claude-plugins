from src.late_fee import late_fee_cents

# Expected values are whatever the code returns today.


def test_zero_or_negative_days():
    assert late_fee_cents(10_000, 0) == 0
    assert late_fee_cents(10_000, -5) == 0


def test_one_day_overdue():
    assert late_fee_cents(10_000, 1) == 200


def test_thirty_one_days_overdue():
    assert late_fee_cents(10_000, 31) == 400


def test_cap():
    assert late_fee_cents(10_000, 300) == 1000
