"""
/llm/* - features backed by the LOCAL language model. Same shared-key protection as every other route (only the Node
backend can call this service), and the backend adds user authentication, role and ownership checks before it calls here.
Errors use the same structured shape the speech/vision routes use: {"detail": {"reason", "message", "retryable"}}.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.services import llm, llm_tasks
from app.services.llm import LlmError
from app.utils.security import verify_api_key

router = APIRouter(prefix="/llm")

HTTP_FOR = {"llm_disabled": 503, "llm_unreachable": 503, "llm_model_missing": 503, "llm_timeout": 503, "llm_busy": 503,
            "llm_misconfigured": 503, "llm_error": 503, "llm_bad_response": 502}


def _raise(e: LlmError):
    raise HTTPException(status_code=HTTP_FOR.get(e.code, 503), detail={"reason": e.code, "message": e.message, "retryable": e.retryable})


def _run(fn, *args):
    try:
        return fn(*args)
    except LlmError as e:
        _raise(e)


class Turn(BaseModel):
    prompt: str = Field(max_length=600)
    answer: str = Field(default="", max_length=4000)


class FollowUpRequest(BaseModel):
    question: str = Field(max_length=1000)
    answer: str = Field(max_length=6000)
    interview_type: str = "technical"
    difficulty: str = "medium"
    target_role: str = ""
    missing_criteria: List[str] = Field(default_factory=list, max_length=10)
    previous_turns: List[Turn] = Field(default_factory=list, max_length=3)


class FollowUpFeedbackRequest(BaseModel):
    prompt: str = Field(max_length=600)
    answer: str = Field(max_length=6000)
    interview_type: str = "technical"


class StarRequest(BaseModel):
    question: str = Field(max_length=1000)
    answer: str = Field(max_length=6000)


class CodeTest(BaseModel):
    index: int
    passed: bool
    input: Optional[str] = Field(default=None, max_length=2000)
    expected: Optional[str] = Field(default=None, max_length=2000)
    actual: Optional[str] = Field(default=None, max_length=2000)
    note: Optional[str] = Field(default=None, max_length=500)


class CodeCoachRequest(BaseModel):
    title: str = Field(max_length=200)
    statement: str = Field(max_length=8000)
    language: str = Field(max_length=20)
    code: str = Field(max_length=20000)
    status: str = Field(max_length=40)
    tests: List[CodeTest] = Field(default_factory=list, max_length=20)
    stderr: str = Field(default="", max_length=4000)


class ReportItem(BaseModel):
    topic: Optional[str] = None
    question: str = Field(max_length=1000)
    answer: str = Field(default="", max_length=6000)
    technical: Optional[float] = None
    relevance: Optional[float] = None
    clarity: Optional[float] = None
    completeness: Optional[float] = None
    matched: List[str] = Field(default_factory=list, max_length=10)
    missing: List[str] = Field(default_factory=list, max_length=10)


class ReportRequest(BaseModel):
    interview_type: str
    target_role: str = ""
    difficulty: str = "medium"
    final_score: Optional[float] = None
    items: List[ReportItem] = Field(max_length=15)


@router.get("/status")
def llm_status(x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    return llm.status()


@router.post("/follow-up")
def make_follow_up(p: FollowUpRequest, x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    out = _run(llm_tasks.follow_up, p.question, p.answer, p.interview_type, p.difficulty, p.target_role, p.missing_criteria, [t.model_dump() for t in p.previous_turns])
    return {**out, "model": llm.config.LLM_MODEL}


@router.post("/follow-up-feedback")
def make_follow_up_feedback(p: FollowUpFeedbackRequest, x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    return {**_run(llm_tasks.follow_up_feedback, p.prompt, p.answer, p.interview_type), "model": llm.config.LLM_MODEL}


@router.post("/star")
def make_star(p: StarRequest, x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    return {**_run(llm_tasks.star_coach, p.question, p.answer), "model": llm.config.LLM_MODEL}


@router.post("/code-coach")
def make_code_coach(p: CodeCoachRequest, x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    out = _run(llm_tasks.code_coach, p.title, p.statement, p.language, p.code, p.status, [t.model_dump() for t in p.tests], p.stderr)
    return {**out, "model": llm.config.LLM_MODEL}


@router.post("/report")
def make_report(p: ReportRequest, x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    out = _run(llm_tasks.interview_report, p.interview_type, p.target_role, p.difficulty, [i.model_dump() for i in p.items], p.final_score)
    return {**out, "model": llm.config.LLM_MODEL}
