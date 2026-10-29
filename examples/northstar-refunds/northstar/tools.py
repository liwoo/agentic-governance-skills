from datetime import date

import httpx
import stripe
from langchain_core.tools import tool
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from .config import settings
from .telemetry import log_tool_result

stripe.api_key = settings.stripe_api_key
_headers = {"Authorization": f"Bearer {settings.automation_key}", "X-Agent-Name": "support-bot"}


def refundable_amount(order_total_pence: int, delivered_on: date, today: date) -> int:
    """Full refund inside 30 days of delivery, nothing after."""
    if (today - delivered_on).days > 30:
        return 0
    return order_total_pence


@tool
def lookup_order(customer_name: str) -> dict:
    """Find the most recent order for a customer by name."""
    response = httpx.get(f"{settings.orders_api}/orders", params={"customer": customer_name}, headers=_headers, timeout=10)
    response.raise_for_status()
    orders = response.json()["orders"]
    return orders[0] if orders else {}


@tool
def issue_refund(order_id: str, amount_pence: int, session_id: str = "") -> dict:
    """Refund an order through Stripe."""
    for attempt in range(3):
        try:
            refund = stripe.Refund.create(payment_intent=order_id, amount=amount_pence)
            break
        except stripe.error.APIConnectionError:
            if attempt == 2:
                raise
    result = {"refund_id": refund.id, "status": refund.status}
    log_tool_result(session_id, "issue_refund", {"order_id": order_id, "amount_pence": amount_pence}, result)
    return result


@tool
def send_customer_email(to: str, subject: str, body: str) -> str:
    """Email a customer."""
    message = Mail(from_email="support@northstar.example", to_emails=to, subject=subject, plain_text_content=body)
    SendGridAPIClient(settings.sendgrid_api_key).send(message)
    return "sent"


TOOLS = [lookup_order, issue_refund, send_customer_email]
