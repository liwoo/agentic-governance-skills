from fastapi import FastAPI
from pydantic import BaseModel

from .agent import app as agent_app
from .agent import run

api = FastAPI(title="Northstar support agent")


class ChatRequest(BaseModel):
    message: str
    thread_id: str | None = None


class ResumeRequest(BaseModel):
    thread_id: str
    answer: str


@api.post("/chat")
def chat(request: ChatRequest) -> dict:
    return run(request.message, request.thread_id)


@api.post("/resume")
def resume(request: ResumeRequest) -> dict:
    from langgraph.types import Command

    config = {"configurable": {"thread_id": request.thread_id}, "recursion_limit": 25}
    return agent_app.invoke(Command(resume=request.answer), config)
