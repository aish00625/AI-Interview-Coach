"""POST /execute — the only endpoint that does real work in this service."""
from fastapi import APIRouter, Header, HTTPException

from app.config import API_KEY
from app.schemas import ExecuteRequest, ExecuteResponse
from app.services import execution_service, image_manager
from app.services.execution_service import execute_submission
from app.utils.language_config import is_supported

router = APIRouter()


def verify_api_key(x_code_executor_key: str = Header(default="")):
    """
    Shared-secret check between Node and this service — not a per-user
    auth system. Node already verified the end user's JWT, and retrieved
    the authoritative test cases from PostgreSQL, before ever calling us;
    this service never talks to the database or to React directly.
    """
    if not API_KEY or x_code_executor_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing code executor key.")


@router.post("/execute", response_model=ExecuteResponse)
def execute(payload: ExecuteRequest, x_code_executor_key: str = Header(default="")):
    verify_api_key(x_code_executor_key)

    if not is_supported(payload.language):
        raise HTTPException(status_code=400, detail="Unsupported language.")

    result = execute_submission(
        language=payload.language,
        source_code=payload.sourceCode,
        test_cases=payload.testCases,
        timeout_ms=payload.timeoutMs,
    )
    return ExecuteResponse(**result)


@router.get("/runtimes")
def runtimes(x_code_executor_key: str = Header(default="")):
    """Authenticated diagnostic: is Docker reachable and is each language image present? No secrets, no source code."""
    verify_api_key(x_code_executor_key)
    return image_manager.snapshot(execution_service._runner)
