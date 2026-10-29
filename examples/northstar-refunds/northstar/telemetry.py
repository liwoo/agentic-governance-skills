import logging

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("northstar.support")
logger = logging.getLogger("northstar")
logging.basicConfig(level=logging.INFO)


def log_tool_result(session_id: str, tool: str, payload: dict, result: dict) -> None:
    """Record what a tool did. Called after the tool returns."""
    with tracer.start_as_current_span(f"tool.{tool}") as span:
        span.set_attribute("session.id", session_id)
        span.set_attribute("tool.name", tool)
        logger.info("tool=%s session=%s payload=%s result=%s", tool, session_id, payload, result)
