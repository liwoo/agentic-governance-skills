from datetime import date

from northstar.tools import refundable_amount


def test_full_refund_inside_window():
    assert refundable_amount(9000, date(2026, 10, 1), date(2026, 10, 20)) == 9000


def test_no_refund_after_window():
    assert refundable_amount(9000, date(2026, 9, 1), date(2026, 10, 20)) == 0
