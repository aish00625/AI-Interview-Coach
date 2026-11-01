"""
Regression tests for the "Execution environment error." incident.

Root causes covered:
  1. Language images were never pulled; containers.create() raises ImageNotFound, which used to be swallowed into the
     generic message. Now: a background pull is requested and the user gets an accurate, safe message.
  2. put_archive cannot write into a read-only container (even into its tmpfs). Source is now piped over exec stdin.
  3. Exit code could be read before the daemon recorded it; it is now polled.
Plus: unexpected exceptions are logged server-side and never leak details; containers are always removed.

    cd code-executor && python -m unittest discover -s tests -v
"""
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
try:
    import docker  # noqa: F401
except ImportError:
    d = types.ModuleType("docker"); e = types.ModuleType("docker.errors")
    class DockerException(Exception): pass
    class ImageNotFound(DockerException): pass
    e.DockerException = DockerException; e.ImageNotFound = ImageNotFound
    d.errors = e; d.from_env = lambda **k: None
    sys.modules["docker"] = d; sys.modules["docker.errors"] = e

from docker.errors import DockerException, ImageNotFound  # noqa: E402
from app.services import execution_service as es, image_manager as im  # noqa: E402
from app.services import docker_runner as dr  # noqa: E402


def tc(i="", o="", flag=False):
    return SimpleNamespace(input=i, expectedOutput=o, returnOutput=flag)


class Box:
    def start(self): pass


class Runner:
    def __init__(self, create_exc=None, write_exc=None, step=None, pull_exc=None):
        self.create_exc, self.write_exc, self.step, self.pull_exc = create_exc, write_exc, step, pull_exc
        self.removed = 0; self.pulled = []; self.present = set()

    def create_workspace_container(self, *a, **k):
        if self.create_exc: raise self.create_exc
        return Box()

    def write_source(self, *a, **k):
        if self.write_exc: raise self.write_exc

    def run_step(self, *a, **k):
        return self.step or dict(exit_code=0, stdout="5", stderr="", timed_out=False, output_truncated=False)

    def remove_container(self, c): self.removed += 1
    def pull_image(self, image):
        self.pulled.append(image)
        if self.pull_exc: raise self.pull_exc
    def image_exists(self, image): return image in self.present
    def ping(self): return True


class FailureClassification(unittest.TestCase):
    def setUp(self):
        im._state.clear()

    def run_with(self, r, language="python"):
        es._runner = r
        return es.execute_submission(language, "print(2+3)", [tc("", "5")])

    def test_missing_image_is_reported_accurately_and_a_pull_is_started(self):
        r = Runner(create_exc=ImageNotFound("No such image: python:3.12.3-slim"))
        out = self.run_with(r)
        self.assertEqual(out["status"], "execution_error")
        self.assertEqual(out["stderr"], es.MSG_PREPARING)
        self.assertNotEqual(out["stderr"], es.MSG_GENERIC)
        import time; time.sleep(0.2)
        self.assertEqual(r.pulled, ["python:3.12.3-slim"])  # the repo's own tag, not an invented one

    def test_failed_pull_gives_a_distinct_message_and_is_not_retried_in_a_loop(self):
        r = Runner(create_exc=ImageNotFound("x"), pull_exc=DockerException("denied"))
        self.run_with(r)
        import time; time.sleep(0.2)
        self.assertEqual(im.state_of("python:3.12.3-slim"), "failed")
        out = self.run_with(r)
        self.assertEqual(out["stderr"], es.MSG_PULL_FAILED)
        time.sleep(0.1)
        self.assertEqual(len(r.pulled), 1)

    def test_unexpected_exception_is_generic_and_leaks_nothing(self):
        r = Runner(step=None); r.write_exc = RuntimeError("secret-token-123 /var/run/docker.sock")
        out = self.run_with(r)
        self.assertEqual((out["status"], out["stderr"]), ("execution_error", es.MSG_GENERIC))
        self.assertEqual(r.removed, 1)

    def test_docker_unreachable_message(self):
        class ConnectionError_(Exception): pass
        out = self.run_with(Runner(create_exc=ConnectionError_("refused")))
        self.assertEqual(out["stderr"], es.MSG_DOCKER_DOWN)

    def test_source_write_failure_cleans_up(self):
        r = Runner(write_exc=dr.SourceWriteError("x"))
        out = self.run_with(r)
        self.assertEqual(out["stderr"], es.MSG_GENERIC)
        self.assertEqual(r.removed, 1)

    def test_output_flood_is_output_limit_not_runtime_error(self):
        r = Runner(step=dict(exit_code=None, stdout="x" * 10, stderr="", timed_out=False, output_truncated=True))
        out = self.run_with(r)
        self.assertEqual(out["status"], "output_limit")
        self.assertEqual(r.removed, 1)

    def test_success_still_completes_and_removes(self):
        r = Runner(); out = self.run_with(r)
        self.assertEqual((out["status"], out["passedTests"]), ("completed", 1))
        self.assertEqual(r.removed, 1)

    def test_compile_step_with_no_exit_code_is_an_environment_error(self):
        r = Runner(step=dict(exit_code=None, stdout="", stderr="", timed_out=False, output_truncated=False))
        out = self.run_with(r, "java")
        self.assertEqual(out["status"], "execution_error")
        self.assertEqual(r.removed, 1)


class ImageManagerTests(unittest.TestCase):
    def setUp(self): im._state.clear()

    def test_ensure_all_pulls_only_missing_images(self):
        r = Runner(); r.present = {"python:3.12.3-slim", "node:20.11.1-slim"}
        res = im.ensure_all(r, wait=True)
        self.assertEqual(sorted(r.pulled), ["eclipse-temurin:21.0.2_13-jdk-jammy", "gcc:13.2.0"])
        self.assertTrue(all(v == "ready" for v in res.values()))

    def test_snapshot_reports_per_language_state(self):
        r = Runner(); r.present = {"python:3.12.3-slim"}
        snap = im.snapshot(r)
        self.assertEqual(snap["docker"], "reachable")
        self.assertEqual(snap["languages"]["python"]["state"], "ready")
        self.assertEqual(snap["languages"]["cpp"], {"image": "gcc:13.2.0", "state": "missing"})


class RunnerMechanics(unittest.TestCase):
    def test_source_goes_over_stdin_to_a_fixed_command_not_put_archive(self):
        seen = {}
        class R(dr.DockerRunner):
            def _exec(self, container, cmd, send, timeout_s, max_output_bytes):
                seen.update(cmd=cmd, stdin=send)
                return dict(exit_code=0, stdout="", stderr="", timed_out=False, output_truncated=False)
        R().write_source(object(), "main.py", "import os; os.system('rm -rf /')  # $(evil) \"quoted\"")
        src = "import os; os.system('rm -rf /')  # $(evil) \"quoted\""
        self.assertEqual(seen["cmd"], ["sh", "-c", 'head -c "$2" > "$1" && [ "$(wc -c < "$1")" -eq "$2" ]', "sh", "main.py", str(len(src.encode()))])
        self.assertIn(b"$(evil)", seen["stdin"])  # source is data, never part of the command
        self.assertNotIn(b"put_archive", Path(dr.__file__).read_bytes().replace(b"`put_archive`", b""))

    def test_failed_write_raises(self):
        class R(dr.DockerRunner):
            def _exec(self, *a, **k): return dict(exit_code=1, stdout="", stderr="no", timed_out=False, output_truncated=False)
        with self.assertRaises(dr.SourceWriteError):
            R().write_source(object(), "main.py", "x")

    def test_exit_code_is_polled_until_recorded(self):
        calls = []
        class Api:
            def exec_create(self, *a, **k): return {"Id": "e"}
            def exec_start(self, *a, **k): return _Sock()
            def exec_inspect(self, _):
                calls.append(1)
                return {"Running": True, "ExitCode": None} if len(calls) < 3 else {"Running": False, "ExitCode": 0}
        class _Sock:
            def __init__(self): self.sent = b""; self.frames = [b"\x01\0\0\0\0\0\0\x01" + b"5"]
            def settimeout(self, t): pass
            def sendall(self, d): pass
            def shutdown(self, h): pass
            def close(self): pass
            def recv(self, n):
                if not self.frames: return b""
                f = self.frames[0]; chunk, self.frames[0] = f[:n], f[n:]
                if not self.frames[0]: self.frames.pop(0)
                return chunk
        r = dr.DockerRunner(); r._client = SimpleNamespace(api=Api())
        out = r.run_step(SimpleNamespace(id="c", kill=lambda: None), ["python3", "main.py"], b"", 2, 1024)
        self.assertEqual((out["exit_code"], out["stdout"]), (0, "5"))
        self.assertGreaterEqual(len(calls), 3)


class NpipeLikeSocket:
    """Behaves like docker-py's Windows NpipeSocket: shutdown() closes the WHOLE connection, any later use raises
    RuntimeError('Can not reuse socket after connection was closed.'), and the server ending the stream surfaces as an
    exception whose args[0] == 109 (ERROR_BROKEN_PIPE) rather than a 0-byte read."""
    def __init__(self, frames=b"", end_style="pipe109"):
        self.buf = frames; self.closed = False; self.sent = b""; self.shutdown_called = False; self.end_style = end_style
    def _chk(self):
        if self.closed: raise RuntimeError("Can not reuse socket after connection was closed.")
    def settimeout(self, t): self._chk()
    def sendall(self, d): self._chk(); self.sent += d
    def shutdown(self, how): self._chk(); self.shutdown_called = True; self.closed = True
    def close(self): self.closed = True
    def recv(self, n):
        self._chk()
        if not self.buf:
            if self.end_style == "pipe109": raise Exception(109, "ReadFile", "The pipe has been ended.")
            return b""
        out, self.buf = self.buf[:n], self.buf[n:]
        return out


def _frame(stream, data): return bytes([stream, 0, 0, 0]) + len(data).to_bytes(4, "big") + data


class WindowsNamedPipeRegression(unittest.TestCase):
    """The incident: shutdown(SHUT_WR) on the exec socket closed the whole Windows pipe, so the next recv raised
    'Can not reuse socket after connection was closed.'"""
    def make(self, sock, exit_info=None):
        class Api:
            def __init__(self): self.created = []
            def exec_create(self, cid, cmd, stdin, stdout, stderr, workdir): self.created.append((cmd, stdin)); return {"Id": "e"}
            def exec_start(self, *a, **k): return sock
            def exec_inspect(self, _): return exit_info or {"Running": False, "ExitCode": 0}
        r = dr.DockerRunner(); r._client = SimpleNamespace(api=Api())
        return r, r._client.api

    def box(self): return SimpleNamespace(id="c", kill=lambda: None)

    def test_run_step_never_half_closes_and_reads_to_pipe_end(self):
        sock = NpipeLikeSocket(_frame(1, b"5\n") + _frame(2, b"warn"))
        r, api = self.make(sock)
        out = r.run_step(self.box(), ["python3", "main.py"], b"", 2, 4096)
        self.assertFalse(sock.shutdown_called)
        self.assertEqual((out["exit_code"], out["stdout"], out["stderr"], out["timed_out"]), (0, "5\n", "warn", False))

    def test_stdin_travels_as_a_file_not_as_a_half_closed_stream(self):
        steps = []
        class R(dr.DockerRunner):
            def _exec(self, container, cmd, send, timeout_s, max_output_bytes):
                steps.append((cmd, send)); return dict(exit_code=0, stdout="", stderr="", timed_out=False, output_truncated=False)
        R().run_step(object(), ["java", "Main"], b"1 2\n", 2, 1024)
        self.assertEqual(steps[0], (["sh", "-c", 'head -c "$2" > "$1" && [ "$(wc -c < "$1")" -eq "$2" ]', "sh", ".stdin", "4"], b"1 2\n"))
        self.assertEqual(steps[1], (["sh", "-c", 'exec "$@" < .stdin', "sh", "java", "Main"], None))
        steps.clear()
        R().run_step(object(), ["./main"], b"", 2, 1024)
        self.assertEqual(steps, [(["sh", "-c", 'exec "$@" < /dev/null', "sh", "./main"], None)])

    def test_write_step_sends_exact_bytes_without_shutdown(self):
        sock = NpipeLikeSocket(b"")
        r, api = self.make(sock)
        r.write_source(self.box(), "main.py", "print(1)")
        self.assertEqual(sock.sent, b"print(1)"); self.assertFalse(sock.shutdown_called)
        self.assertTrue(api.created[0][1])  # stdin attached only for the write step

    def test_closed_socket_error_is_not_masked_as_end_of_stream(self):
        sock = NpipeLikeSocket(b""); sock.closed = True
        r, _ = self.make(sock)
        with self.assertRaises(RuntimeError):
            r.run_step(self.box(), ["x"], b"", 2, 1024)

    def test_plain_zero_byte_eof_still_ends_the_stream(self):
        sock = NpipeLikeSocket(_frame(1, b"ok"), end_style="zero")
        r, _ = self.make(sock)
        self.assertEqual(r.run_step(self.box(), ["x"], b"", 2, 1024)["stdout"], "ok")


import threading  # noqa: E402
import time  # noqa: E402


class BlockingPipeSocket:
    """Reproduces the Windows hang: docker-py's NpipeSocket ignores settimeout(), so recv() blocks until the server ends the
    stream. Here that only happens when `release()` is called (what killing the container does)."""
    def __init__(self, ignore_kill=False):
        self._released = threading.Event(); self.closed = False; self.ignore_kill = ignore_kill; self.sent = b""
    def release(self):
        if not self.ignore_kill: self._released.set()
    def settimeout(self, t): pass  # <- the bug: the timeout is silently ignored
    def sendall(self, d): self.sent += d
    def shutdown(self, how): raise AssertionError("must not half-close")
    def close(self): self.closed = True
    def recv(self, n):
        self._released.wait()  # blocks like ReadFile on an idle pipe
        raise Exception(109, "ReadFile", "The pipe has been ended.")


class NeverEndingProgramHang(unittest.TestCase):
    """`while True: pass` prints nothing and never exits. The 1.5 s limit must still fire and the call must return."""
    def make(self, sock):
        killed = []
        class Api:
            def exec_create(self, *a, **k): return {"Id": "e"}
            def exec_start(self, *a, **k): return sock
            def exec_inspect(self, _): return {"Running": False, "ExitCode": 137}
        box = SimpleNamespace(id="abcdef1234567890", kill=lambda: (killed.append(1), sock.release()))
        r = dr.DockerRunner(); r._client = SimpleNamespace(api=Api())
        return r, box, killed

    def test_timeout_fires_even_though_recv_ignores_timeouts(self):
        sock = BlockingPipeSocket(); r, box, killed = self.make(sock)
        t0 = time.monotonic()
        out = r.run_step(box, ["python3", "main.py"], b"", 0.3, 4096)
        self.assertLess(time.monotonic() - t0, 2.5, "run_step must not block past its timeout")
        self.assertTrue(out["timed_out"]); self.assertEqual(killed, [1])  # exactly this container was killed, once
        self.assertTrue(sock.closed); self.assertIsNone(out["exit_code"])

    def test_returns_even_if_the_stream_stays_blocked_after_the_kill(self):
        sock = BlockingPipeSocket(ignore_kill=True); r, box, killed = self.make(sock)
        old = dr.KILL_GRACE_S; dr.KILL_GRACE_S = 0.3
        try:
            t0 = time.monotonic()
            out = r.run_step(box, ["python3", "main.py"], b"", 0.2, 4096)
        finally:
            dr.KILL_GRACE_S = old
        self.assertLess(time.monotonic() - t0, 2.5)
        self.assertTrue(out["timed_out"]); self.assertEqual(killed, [1])

    def test_a_program_that_finishes_in_time_is_not_killed(self):
        sock = NpipeLikeSocket(_frame(1, b"5\n")); killed = []
        class Api:
            def exec_create(self, *a, **k): return {"Id": "e"}
            def exec_start(self, *a, **k): return sock
            def exec_inspect(self, _): return {"Running": False, "ExitCode": 0}
        r = dr.DockerRunner(); r._client = SimpleNamespace(api=Api())
        out = r.run_step(SimpleNamespace(id="c", kill=lambda: killed.append(1)), ["x"], b"", 2, 4096)
        self.assertFalse(out["timed_out"]); self.assertEqual(killed, []); self.assertEqual(out["stdout"], "5\n")

    def test_output_flood_kills_the_container_and_returns(self):
        class Flood(BlockingPipeSocket):
            def recv(self, n):
                if not hasattr(self, "buf"): self.buf = (_frame(1, b"x" * 5000) * 5)
                if self.buf: out, self.buf = self.buf[:n], self.buf[n:]; return out
                return super().recv(n)
        sock = Flood(); r, box, killed = self.make(sock)
        out = r.run_step(box, ["x"], b"", 5, 1000)
        self.assertTrue(out["output_truncated"]); self.assertFalse(out["timed_out"]); self.assertEqual(killed, [1])

    def test_docker_client_has_a_bounded_api_timeout(self):
        calls = {}
        orig = dr.docker.from_env
        dr.docker.from_env = lambda **kw: calls.update(kw) or object()
        try: dr.DockerRunner()._get_client()
        finally: dr.docker.from_env = orig
        self.assertEqual(calls.get("timeout"), dr.DOCKER_API_TIMEOUT_S); self.assertGreater(dr.DOCKER_API_TIMEOUT_S, 0)


try:
    import fastapi  # noqa: F401
    from fastapi.testclient import TestClient
    HAVE_FASTAPI = True
except Exception:
    HAVE_FASTAPI = False


@unittest.skipUnless(HAVE_FASTAPI, "fastapi not installed in this environment")
class RuntimesEndpoint(unittest.TestCase):
    def test_requires_key_and_reports_languages(self):
        from app.routes import execution as route
        from app.main import app
        route.API_KEY = "k"; es._runner = Runner()
        c = TestClient(app)
        self.assertEqual(c.get("/runtimes").status_code, 401)
        self.assertEqual(c.get("/runtimes", headers={"X-Code-Executor-Key": "wrong"}).status_code, 401)
        ok = c.get("/runtimes", headers={"X-Code-Executor-Key": "k"})
        self.assertEqual(ok.status_code, 200)
        self.assertIn("python", ok.json()["languages"])
        self.assertNotIn("k", str(ok.json().get("key", "")))


if __name__ == "__main__":
    unittest.main()
