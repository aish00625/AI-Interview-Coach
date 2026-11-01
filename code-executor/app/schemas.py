"""
Pydantic request/response models for the executor's HTTP contract with
Node. camelCase field names match backend/services/codeExecutorClient.js
directly, same rationale as the AI service's schemas.py.
"""
from typing import List, Optional
from pydantic import BaseModel, Field

SUPPORTED_STATUSES = {
    "completed", "compilation_error", "runtime_error",
    "timeout", "memory_limit", "output_limit", "execution_error",
}


class ExecuteTestCase(BaseModel):
    input: str = ""
    expectedOutput: str
    # Executor contract v1.1 (additive, optional). Node sets this ONLY for tests that are already public to the
    # candidate (the problem's visible sample tests); it asks the executor to echo the program's actual output
    # for that test. Hidden tests never set it, so their output can never leave the executor. Default False
    # keeps v1.0 behaviour exactly.
    returnOutput: bool = False


class ExecuteRequest(BaseModel):
    language: str
    sourceCode: str
    # Always populated by Node from PostgreSQL's authoritative coding_problems.test_cases
    # — the browser never supplies this. See execution_service.py for the limits enforced.
    testCases: List[ExecuteTestCase] = Field(default_factory=list)
    timeoutMs: Optional[int] = None


class TestResult(BaseModel):
    """
    Minimal by default: index + pass/fail only. No expectedOutput and no
    test input are ever included. The v1.1 optional fields below appear
    only for tests the request explicitly flagged returnOutput (public
    sample tests), so hidden test data cannot leak even if Node forwarded
    the object unchanged.
    """
    index: int
    passed: bool
    # Executor contract v1.1 (additive, optional): present only for tests the request flagged returnOutput.
    # actualOutput is truncated; stderr is the (truncated) runtime error text for that test, if any;
    # durationMs is the wall-clock time of that test's run step measured inside the executor (includes container
    # exec overhead, so treat it as an upper bound on the program's own run time).
    actualOutput: Optional[str] = None
    stderr: Optional[str] = None
    durationMs: Optional[int] = None


class ExecuteResponse(BaseModel):
    status: str  # one of SUPPORTED_STATUSES
    passedTests: int = Field(ge=0)
    totalTests: int = Field(ge=0)
    executionTimeMs: int = Field(ge=0)
    memoryUsedKb: Optional[int] = None
    tests: List[TestResult]
    # Safe compiler/runtime error text ONLY (truncated) — never test case
    # data. Empty string when there's nothing to report.
    stderr: str = ""


class HealthResponse(BaseModel):
    status: str
    service: str
