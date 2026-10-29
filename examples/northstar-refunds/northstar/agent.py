import uuid
from typing import Annotated, TypedDict

from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt

from .config import settings
from .prompts import SYSTEM_PROMPT
from .tools import TOOLS


class State(TypedDict):
    messages: Annotated[list, add_messages]
    refund_approved: bool


model = ChatOpenAI(model=settings.openai_model).bind_tools(TOOLS)


def call_model(state: State) -> dict:
    return {"messages": [model.invoke([("system", SYSTEM_PROMPT), *state["messages"]])]}


def confirm_refund(state: State) -> dict:
    """Ask a human before refunds. The UI shows 'Agent wants to issue a refund — Allow?'."""
    last = state["messages"][-1]
    if any(call["name"] == "issue_refund" for call in last.tool_calls) and not state.get("refund_approved"):
        answer = interrupt({"question": "Agent wants to issue a refund — Allow?"})
        return {"refund_approved": answer == "yes"}
    return {}


def route(state: State) -> str:
    last = state["messages"][-1]
    return "confirm" if getattr(last, "tool_calls", None) else END


graph = StateGraph(State)
graph.add_node("model", call_model)
graph.add_node("confirm", confirm_refund)
graph.add_node("tools", ToolNode(TOOLS))
graph.add_edge(START, "model")
graph.add_conditional_edges("model", route, {"confirm": "confirm", END: END})
graph.add_edge("confirm", "tools")
graph.add_edge("tools", "model")
app = graph.compile(checkpointer=MemorySaver())


def run(user_message: str, thread_id: str | None = None) -> dict:
    thread_id = thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 25}
    return app.invoke({"messages": [("user", user_message)]}, config)
