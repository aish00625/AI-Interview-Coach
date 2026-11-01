"""
Orchestration tests for app/services/execution_service.py using a FAKE container runner. They prove the result
shape, status decisions and the executor-contract-v1.1 rule that actual output is echoed ONLY for tests flagged
returnOutput. They do NOT prove Docker isolation - nothing here talks to a Docker daemon. Real execution is covered
by the Windows end-to-end checklist.

    cd code-executor && python -m unittest discover -s tests -v
"""
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# The `docker` SDK is not needed for these tests; provide just enough of its surface if it is not installed.
try:
    import docker  # noqa: F401
except ImportError:
    docker_mod = types.ModuleType("docker")
    errors_mod = types.ModuleType("docker.errors")

    class DockerException(Exception):
        pass

    class ImageNotFound(DockerException):
        pass

    errors_mod.DockerException = DockerException
    errors_mod.ImageNotFound = ImageNotFound
    docker_mod.errors = errors_mod
    docker_mod.from_env = lambda **k: None
    sys.modules["docker"] = docker_mod
    sys.modules["docker.errors"] = errors_mod

from app.services import execution_service as es  # noqa: E402
from app.schemas import ExecuteRequest, ExecuteResponse, ExecuteTestCase  # noqa: E402


class FakeContainer:
    def start(self):
        pass


class FakeRunner:
    """Maps stdin -> canned step result; records every call so tests can assert on behaviour."""

    def __init__(self, outputs=None, compile_result=None, timeouts=(), crashes=()):
        self.outputs = outputs or {}
        self.compile_result = compile_result
        self.timeouts = set(timeouts)
        self.crashes = set(crashes)
        self.removed = False
        self.steps = []

    def create_workspace_container(self, *a, **k):
        return FakeContainer()

    def write_source(self, *a, **k):
        pass

    def run_step(self, container, cmd, stdin_data, timeout_s, max_bytes):
        text = stdin_data.decode()
        self.steps.append(text)
        if not stdin_data and self.compile_result is not None and cmd and cmd[0] in ("javac", "g++"):
            return self.compile_result
        if text in self.timeouts:
            return dict(exit_code=None, stdout="", stderr="", timed_out=True, output_truncated=False)
        if text in self.crashes:
            return dict(exit_code=1, stdout="partial", stderr="Traceback: boom", timed_out=False, output_truncated=False)
        return dict(exit_code=0, stdout=self.outputs.get(text, ""), stderr="", timed_out=False, output_truncated=False)

    def remove_container(self, container):
        self.removed = True


def tc(inp, expected, flag=False):
    return SimpleNamespace(input=inp, expectedOutput=expected, returnOutput=flag)


class ExecutionServiceTests(unittest.TestCase):
    def run_with(self, runner, tests, language="python", source="print(1)"):
        es._runner = runner
        return es.execute_submission(language, source, tests)

    def test_v10_shape_is_unchanged_when_nothing_is_flagged(self):
        r = FakeRunner(outputs={"1\n": "2\n", "2\n": "4\n"})
        out = self.run_with(r, [tc("1\n", "2"), tc("2\n", "5")])
        self.assertEqual(out["status"], "completed")
        self.assertEqual((out["passedTests"], out["totalTests"]), (1, 2))
        self.assertEqual(out["tests"], [{"index": 1, "passed": True}, {"index": 2, "passed": False}])
        self.assertTrue(r.removed)

    def test_actual_output_only_for_flagged_tests(self):
        r = FakeRunner(outputs={"a": "SECRET-HIDDEN-OUTPUT", "b": "visible-out"})
        out = self.run_with(r, [tc("a", "x", flag=False), tc("b", "visible-out", flag=True)])
        hidden, visible = out["tests"]
        self.assertEqual(set(hidden), {"index", "passed"})
        self.assertNotIn("SECRET-HIDDEN-OUTPUT", repr(out))
        self.assertEqual(visible["actualOutput"], "visible-out")
        self.assertTrue(visible["passed"])
        self.assertIsInstance(visible["durationMs"], int)

    def test_failed_flagged_test_reports_actual_vs_expected_material(self):
        out = self.run_with(FakeRunner(outputs={"in": "wrong\n"}), [tc("in", "right", flag=True)])
        t = out["tests"][0]
        self.assertFalse(t["passed"])
        self.assertEqual(t["actualOutput"], "wrong")

    def test_runtime_error_returns_stderr_for_flagged_test_only(self):
        out = self.run_with(FakeRunner(crashes={"x", "y"}), [tc("x", "1", flag=True), tc("y", "1", flag=False)])
        self.assertEqual(out["status"], "runtime_error")
        self.assertIn("boom", out["tests"][0]["stderr"])
        self.assertNotIn("stderr", out["tests"][1])

    def test_output_echo_is_truncated(self):
        big = "z" * 10000
        out = self.run_with(FakeRunner(outputs={"i": big}), [tc("i", "q", flag=True)])
        self.assertEqual(len(out["tests"][0]["actualOutput"]), es.ECHO_OUTPUT_MAX_CHARS)

    def test_timeout_stops_further_tests_and_still_cleans_up(self):
        r = FakeRunner(timeouts={"slow"})
        out = self.run_with(r, [tc("ok", ""), tc("slow", "", flag=True), tc("never", "")])
        self.assertEqual(out["status"], "timeout")
        self.assertEqual(len(out["tests"]), 2)
        self.assertNotIn("never", r.steps)
        self.assertTrue(r.removed)
        self.assertIsNone(out["tests"][1]["actualOutput"])

    def test_compile_error_reports_stderr_not_tests(self):
        r = FakeRunner(compile_result=dict(exit_code=1, stdout="", stderr="Main.java:1: error", timed_out=False, output_truncated=False))
        out = self.run_with(r, [tc("a", "b", flag=True)], language="java", source="class Main{")
        self.assertEqual(out["status"], "compilation_error")
        self.assertEqual(out["tests"], [])
        self.assertIn("error", out["stderr"])

    def test_limits_still_enforced(self):
        out = self.run_with(FakeRunner(), [], language="python")
        self.assertEqual(out["status"], "execution_error")
        many = [tc(str(i), "") for i in range(es.MAX_TEST_CASES + 5)]
        out = self.run_with(FakeRunner(), many)
        self.assertEqual(out["totalTests"], es.MAX_TEST_CASES)

    def test_unsupported_language_never_reaches_the_runner(self):
        r = FakeRunner()
        es._runner = r
        out = es.execute_submission("brainfuck", "+", [tc("a", "b")])
        self.assertEqual(out["status"], "execution_error")
        self.assertEqual(r.steps, [])


class SchemaTests(unittest.TestCase):
    def test_old_request_without_returnoutput_is_valid_and_defaults_false(self):
        req = ExecuteRequest(language="python", sourceCode="print(1)", testCases=[{"input": "", "expectedOutput": "1"}])
        self.assertFalse(req.testCases[0].returnOutput)

    def test_response_model_accepts_both_shapes(self):
        base = dict(status="completed", passedTests=1, totalTests=1, executionTimeMs=3)
        ExecuteResponse(**base, tests=[{"index": 1, "passed": True}])
        r = ExecuteResponse(**base, tests=[{"index": 1, "passed": True, "actualOutput": "1", "stderr": None, "durationMs": 2}])
        self.assertEqual(r.tests[0].actualOutput, "1")


if __name__ == "__main__":
    unittest.main()
