"""POST /evaluate — text-answer evaluation, unchanged in behavior since Phase 7."""
from fastapi import APIRouter, Header

from app.schemas import EvaluateRequest, EvaluateResponse
from app.services.evaluator import evaluate_answer
from app.utils.security import verify_api_key

router = APIRouter()


@router.post("/evaluate", response_model=EvaluateResponse)
def evaluate(payload: EvaluateRequest, x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)

    result = evaluate_answer(
        question=payload.question,
        answer=payload.answer,
        target_role=payload.target_role,
        difficulty=payload.difficulty,
        interview_type=payload.interview_type,
    )
    return EvaluateResponse(**result)
