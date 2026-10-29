import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    openai_model: str = os.getenv("NORTHSTAR_MODEL", "gpt-4o")  # floating alias
    stripe_api_key: str = os.environ.get("STRIPE_API_KEY", "")
    sendgrid_api_key: str = os.environ.get("SENDGRID_API_KEY", "")
    # Shared by the support bot, the returns bot and the nightly reconciler.
    automation_key: str = os.environ.get("SUPPORT_AUTOMATION_KEY", "")
    orders_api: str = os.getenv("ORDERS_API", "https://orders.internal.northstar.example")


settings = Settings()
