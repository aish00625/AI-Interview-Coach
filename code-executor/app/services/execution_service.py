"""
Orchestrates one submission's execution: create container → write source
→ compile (if needed) → run each test case → compare output → clean up.
This is the only module that decides the final `status`; docker_runner.py
only knows how to run commands in a container.
"""
import logging
import time
from typing import List, Optional

from docker.errors import DockerException, ImageNotFound

from app.config import (
    DEFAULT_TIMEOUT_MS, MEMORY_LIMIT_MB, CPU_LIMIT_CORES, PIDS_LIMIT,
    MAX_OUTPUT_BYTES, MAX_SOURCE_CODE_BYTES, MAX_TEST_CASES, WORKSPACE_TMPFS_SIZE,
)
from app.services import image_manager
from app.services.docker_runner import DockerRunner, SourceWriteError
from app.utils.language_config import get_language_config, is_supported

log = logging.getLogger("code_executor")

_runner = DockerRunner()

# Safe, user-facing texts. The real exception goes to the server log only (type + short message, never source code).
MSG_GENERIC = "Execution environment error."
MSG_PREPARING = "The code runtime is still being prepared on the executor. Please try again in a few minutes."
MSG_PULL_FAILED = "The code runtime could not be prepared on the executor. Ask the administrator to check the executor logs."
MSG_DOCKER_DOWN = "The code executor cannot reach Docker. Ask the administrator to check that Docker is running."

# Executor contract v1.1: cap on the actual output / per-test stderr echoed back for tests flagged returnOutput.
ECHO_OUTPUT_MAX_CHARS = 2000
ECHO_STDERR_MAX_CHARS = 1000

COMPILE_TIMEOUT_S = 10  # separate, generous fixed budget for compilation — not per-test-case timeoutMs


def _elapsed_ms(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


def _result(status: str, passed: int, total: int, start: float, tests: Optional[List[dict]] = None, stderr: str = ""):
    return {
        "status": status,
        "passedTests": passed,
        "totalTests": total,
        "executionTimeMs": _elapsed_ms(start),
        "memoryUsedKb": None,  # not reliably measured in this phase — see README
        "tests": tests or [],
        "stderr": stderr[:2000],  # safe compiler/runtime text only, truncated defensively
    }


def _wants_output(tc) -> bool:
    return bool(getattr(tc, "returnOutput", False))


def _test_entry(index: int, passed: bool, tc, *, actual: Optional[str] = None, stderr: Optional[str] = None,
                duration_ms: Optional[int] = None) -> dict:
    """v1.0 shape ({index, passed}) unless the test was flagged returnOutput, then the optional v1.1 fields too."""
    entry = {"index": index, "passed": passed}
    if _wants_output(tc):
        entry["actualOutput"] = None if actual is None else actual[:ECHO_OUTPUT_MAX_CHARS]
        entry["stderr"] = None if not stderr else stderr[:ECHO_STDERR_MAX_CHARS]
        entry["durationMs"] = duration_ms
    return entry


def execute_submission(language: str, source_code: str, test_cases: list, timeout_ms: Optional[int] = None) -> dict:
    start = time.monotonic()
    total = len(test_cases)

    if not is_supported(language):
        # Node already validates this against the same allowlist before
        # calling us — this is defense in depth, not the primary check.
        return _result("execution_error", 0, total, start, stderr="Unsupported language.")

    if len(source_code.encode("utf-8")) > MAX_SOURCE_CODE_BYTES:
        return _result("execution_error", 0, total, start, stderr="Source code exceeds the maximum allowed size.")

    test_cases = test_cases[:MAX_TEST_CASES]  # hard cap, defense in depth even though Node should already cap this
    total = len(test_cases)
    if total == 0:
        return _result("execution_error", 0, 0, start, stderr="No test cases were provided for this problem.")

    timeout_s = (timeout_ms or DEFAULT_TIMEOUT_MS) / 1000
    cfg = get_language_config(language)

    container = None
    try:
        container = _runner.create_workspace_container(
            cfg.image, CPU_LIMIT_CORES, MEMORY_LIMIT_MB, PIDS_LIMIT, WORKSPACE_TMPFS_SIZE,
            allow_exec=cfg.run_cmd[0].startswith("./"),  # only a language that runs its own compiled binary needs it
        )
        log.info("starting container %s", container.id[:12] if getattr(container, "id", None) else "?")
        container.start()
        log.info("container started; writing %s", cfg.source_filename)
        _runner.write_source(container, cfg.source_filename, source_code)

        if cfg.compile_cmd:
            compile_result = _runner.run_step(container, cfg.compile_cmd, b"", COMPILE_TIMEOUT_S, MAX_OUTPUT_BYTES)
            if compile_result["timed_out"]:
                return _result("timeout", 0, total, start, stderr="Compilation timed out.")
            if compile_result["exit_code"] is None:
                log.error("compile step for %s ended without an exit code", language)
                return _result("execution_error", 0, total, start, stderr=MSG_GENERIC)
            if compile_result["exit_code"] != 0:
                return _result("compilation_error", 0, total, start, stderr=compile_result["stderr"])

        tests = []
        passed = 0
        overall_status = "completed"

        for i, tc in enumerate(test_cases, start=1):
            step_start = time.monotonic()
            try:
                result = _runner.run_step(container, cfg.run_cmd, tc.input.encode("utf-8"), timeout_s, MAX_OUTPUT_BYTES)
            except (DockerException, OSError):
                # Most likely: the container was already killed by a prior
                # test case's timeout. Every remaining test is un-gradable.
                tests.append(_test_entry(i, False, tc, duration_ms=_elapsed_ms(step_start)))
                overall_status = "execution_error"
                continue
            duration_ms = _elapsed_ms(step_start)

            if result["timed_out"]:
                tests.append(_test_entry(i, False, tc, duration_ms=duration_ms))
                overall_status = "timeout"
                break  # the container was just killed — no point trying further tests on it

            if result["output_truncated"] and result["exit_code"] is None:
                # The runner killed a process that kept producing output past the cap; the container is gone.
                tests.append(_test_entry(i, False, tc, actual=result["stdout"], duration_ms=duration_ms))
                overall_status = "output_limit"
                break

            if result["exit_code"] != 0:
                tests.append(_test_entry(i, False, tc, actual=result["stdout"], stderr=result["stderr"], duration_ms=duration_ms))
                if overall_status == "completed":
                    overall_status = "runtime_error"
                continue

            actual = result["stdout"].strip()
            expected = tc.expectedOutput.strip()
            ok = actual == expected
            if ok:
                passed += 1
            tests.append(_test_entry(i, ok, tc, actual=actual, stderr=result["stderr"], duration_ms=duration_ms))

            if result["output_truncated"] and overall_status == "completed":
                overall_status = "output_limit"

        return _result(overall_status, passed, total, start, tests=tests)

    except ImageNotFound:
        state = image_manager.request_pull(_runner, cfg.image)
        log.error("execution image %s is not present on the Docker host (pull state: %s)", cfg.image, state)
        msg = MSG_PULL_FAILED if state == "failed" else MSG_PREPARING
        return _result("execution_error", 0, total, start, stderr=msg)
    except SourceWriteError as exc:
        log.error("source write failed for %s: %s", language, exc)
        return _result("execution_error", 0, total, start, stderr=MSG_GENERIC)
    except Exception as exc:  # DockerException, requests/urllib3 connection errors, OSError, ... - never leak details
        log.error("execution failed for %s: %s: %s", language, type(exc).__name__, str(exc)[:300])
        down = "connection" in type(exc).__name__.lower() or "Error while fetching server API version" in str(exc)
        return _result("execution_error", 0, total, start, stderr=MSG_DOCKER_DOWN if down else MSG_GENERIC)
    finally:
        if container is not None:
            _runner.remove_container(container)
