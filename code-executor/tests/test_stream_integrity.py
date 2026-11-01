"""
Regression tests for lost program output and unverified input writes.

Root causes covered:
  1. docker-py's exec_start(socket=True) returns the raw stream UNDER the BufferedReader that parsed the HTTP upgrade
     response. Output that arrived together with the response headers sat in that reader's buffer and was never read,
     so a program's stdout could come back empty (or missing its start) with exit code 0 and be graded wrong.
     Now reads go through the buffered reader when it sits directly on the returned stream.
  2. `head -c N` exits 0 when its input ends early, so a short input write went unnoticed and the program ran on
     incomplete input. Now the write command checks the byte count and a mismatch raises SourceWriteError.
  3. OSError while reading the stream was silently dropped. Now it is raised (callers classify it as execution_error).

    cd code-executor && python -m unittest discover -s tests -v
"""
import io
import shutil
import subprocess
import sys
import threading
import time
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

from app.services import execution_service as es  # noqa: E402
from app.services import docker_runner as dr  # noqa: E402


def _frame(stream, data): return bytes([stream, 0, 0, 0]) + len(data).to_bytes(4, "big") + data


class _Wire:
    """The bytes the daemon sent, consumed in order by whoever reads first (the buffered reader or the raw socket)."""
    def __init__(self, data, blocking=None):
        self.data = data; self.blocking = blocking; self.error = None
    def take(self, n):
        if not self.data and self.blocking is not None:
            self.blocking.wait()
        if self.error is not None and not self.data:
            raise self.error
        out, self.data = self.data[:n], self.data[n:]
        return out


class _RawSocket:
    """Stands in for the socket object under docker-py's SocketIO (`SocketIO._sock`)."""
    def __init__(self, wire): self.wire = wire; self.sent = b""; self.closed = False
    def recv(self, n): return self.wire.take(n)
    def sendall(self, d): self.sent += d
    def close(self): self.closed = True


class _SocketIO(io.RawIOBase):
    """Like socket.SocketIO: what docker-py returns for exec_start(socket=True), and the raw of the response's reader."""
    def __init__(self, wire):
        super().__init__(); self._sock = _RawSocket(wire)
    def readable(self): return True
    def readinto(self, b):
        chunk = self._sock.wire.take(len(b))
        b[:len(chunk)] = chunk
        return len(chunk)


def handoff(wire_bytes, prebuffered, blocking=None):
    """
    Builds what docker-py hands back after the HTTP upgrade: a SocketIO whose response BufferedReader has already pulled
    the first `prebuffered` stream bytes into its buffer (as http.client does while reading the headers).
    """
    wire = _Wire(wire_bytes[:prebuffered], blocking)
    sockio = _SocketIO(wire)
    reader = io.BufferedReader(sockio, buffer_size=64 * 1024)
    if prebuffered:
        reader.peek(1)                                   # the header-parse read that also pulled in stream bytes
    wire.data += wire_bytes[prebuffered:]                # the rest is still "on the wire"
    sockio._response = SimpleNamespace(raw=SimpleNamespace(_fp=SimpleNamespace(fp=reader)))
    return sockio, reader, wire


def runner_for(sock, exit_code=0, killed=None):
    class Api:
        def __init__(self): self.created = []
        def exec_create(self, cid, cmd, **k): self.created.append(cmd); return {"Id": "e"}
        def exec_start(self, *a, **k): return sock
        def exec_inspect(self, _): return {"Running": False, "ExitCode": exit_code}
    r = dr.DockerRunner(); r._client = SimpleNamespace(api=Api())
    box = SimpleNamespace(id="c0ffee", kill=lambda: (killed.append(1) if killed is not None else None))
    return r, box


class BufferedOutputIsNotLost(unittest.TestCase):
    OUT = _frame(1, b"825 1311\n") + _frame(2, b"warning\n") + _frame(1, b"tail\n")

    def test_output_fully_prebuffered_at_handoff_is_returned(self):
        sock, reader, _ = handoff(self.OUT, prebuffered=len(self.OUT))
        r, box = runner_for(sock)
        out = r.run_step(box, ["python3", "main.py"], b"", 2, 4096)
        self.assertEqual((out["exit_code"], out["stdout"], out["stderr"]), (0, "825 1311\ntail\n", "warning\n"))

    def test_partly_buffered_frames_and_later_bytes_are_both_read(self):
        for cut in (3, 8, 12, len(_frame(1, b"825 1311\n")) + 5):   # inside a header, at a boundary, inside a payload
            with self.subTest(cut=cut):
                sock, reader, _ = handoff(self.OUT, prebuffered=cut)
                r, box = runner_for(sock)
                out = r.run_step(box, ["x"], b"", 2, 4096)
                self.assertEqual((out["stdout"], out["stderr"]), ("825 1311\ntail\n", "warning\n"))

    def test_large_output_split_across_buffer_and_socket_is_byte_exact(self):
        payload = bytes(range(32, 127)) * 300                # ~28 KB, like a big expected output
        wire = _frame(1, payload[:9000]) + _frame(1, payload[9000:])
        sock, reader, _ = handoff(wire, prebuffered=5000)
        r, box = runner_for(sock)
        out = r.run_step(box, ["x"], b"", 2, 65536)
        self.assertEqual(out["stdout"].encode(), payload)
        self.assertFalse(out["output_truncated"])

    def test_the_old_raw_socket_read_really_loses_the_buffered_bytes(self):
        # Documents the defect: reading the raw socket under the reader skips what the reader already holds.
        sock, reader, _ = handoff(self.OUT, prebuffered=len(self.OUT))
        self.assertEqual(sock._sock.recv(4096), b"")

    def test_writes_and_close_still_use_the_raw_socket(self):
        sock, reader, _ = handoff(b"", prebuffered=0)
        stream = dr._ExecStream(sock)
        self.assertTrue(stream.buffered)
        stream.sendall(b"abc"); stream.close()
        self.assertEqual(sock._sock.sent, b"abc"); self.assertTrue(sock._sock.closed)


class FallbackToRawSocket(unittest.TestCase):
    def test_no_response_object_uses_the_raw_socket(self):
        sock = _SocketIO(_Wire(_frame(1, b"ok")))           # no _response attached
        self.assertFalse(dr._ExecStream(sock).buffered)
        r, box = runner_for(sock)
        self.assertEqual(r.run_step(box, ["x"], b"", 2, 1024)["stdout"], "ok")

    def test_closed_reader_is_not_used(self):
        sock, reader, _ = handoff(_frame(1, b"ok"), prebuffered=0)
        reader.close()
        self.assertIsNone(dr._buffered_reader(sock))

    def test_reader_on_a_different_object_is_not_used(self):
        # docker-py's Windows named-pipe handoff returns fp.raw.sock, so the reader's raw is NOT the returned object.
        sock, reader, _ = handoff(b"", prebuffered=0)
        other = _SocketIO(_Wire(b"")); other._response = sock._response
        self.assertIsNone(dr._buffered_reader(other))

    def test_windows_named_pipe_still_reads_to_pipe_end_without_touching_the_reader(self):
        class NpipeLike:
            def __init__(self, data): self.buf = data; self.closed = False; self.sent = b""
            def sendall(self, d): self.sent += d
            def close(self): self.closed = True
            def recv(self, n):
                if not self.buf: raise Exception(109, "ReadFile", "The pipe has been ended.")
                out, self.buf = self.buf[:n], self.buf[n:]; return out
        class Exploding:
            raw = None; closed = False
            def read1(self, n): raise AssertionError("the named-pipe path must not read through the response reader")
        pipe = NpipeLike(_frame(1, b"5\n") + _frame(2, b"warn"))
        pipe._response = SimpleNamespace(raw=SimpleNamespace(_fp=SimpleNamespace(fp=Exploding())))
        r, box = runner_for(pipe)
        out = r.run_step(box, ["python3", "main.py"], b"", 2, 4096)
        self.assertEqual((out["exit_code"], out["stdout"], out["stderr"]), (0, "5\n", "warn"))
        self.assertTrue(pipe.closed)


class ReadErrorsAreNotSwallowed(unittest.TestCase):
    def test_connection_reset_mid_stream_raises_instead_of_returning_partial_output(self):
        sock, reader, wire = handoff(_frame(1, b"partial"), prebuffered=0)
        wire.error = ConnectionResetError(104, "Connection reset by peer")
        r, box = runner_for(sock)
        with self.assertRaises(OSError):
            r.run_step(box, ["x"], b"", 2, 1024)

    def test_service_classifies_a_read_failure_as_an_environment_error(self):
        class R:
            def create_workspace_container(self, *a, **k): return SimpleNamespace(start=lambda: None)
            def write_source(self, *a, **k): pass
            def run_step(self, *a, **k): raise ConnectionResetError(104, "reset")
            def remove_container(self, c): self.removed = True
        es._runner = R()
        out = es.execute_submission("python", "print(5)", [SimpleNamespace(input="", expectedOutput="5", returnOutput=False)])
        self.assertEqual(out["status"], "execution_error")
        self.assertEqual(out["passedTests"], 0)
        self.assertTrue(es._runner.removed)


class IncompleteInputIsDetected(unittest.TestCase):
    def test_write_command_checks_the_byte_count(self):
        self.assertEqual(dr.WRITE_FILE_SCRIPT, 'head -c "$2" > "$1" && [ "$(wc -c < "$1")" -eq "$2" ]')

    def test_short_write_raises_and_the_program_is_never_started(self):
        cmds = []
        class R(dr.DockerRunner):
            def _exec(self, container, cmd, send, timeout_s, max_output_bytes):
                cmds.append(cmd)
                ok = cmd[2] != dr.WRITE_FILE_SCRIPT           # the size check fails for the write step
                return dict(exit_code=0 if ok else 1, stdout="", stderr="", timed_out=False, output_truncated=False)
        with self.assertRaises(dr.SourceWriteError):
            R().run_step(object(), ["python3", "main.py"], b"5\n1 2 3 4 5\n", 2, 1024)
        self.assertEqual(len(cmds), 1, "the program must not run after a failed input write")

    def test_service_reports_execution_error_and_runs_no_test_on_incomplete_input(self):
        class R:
            ran = 0
            def create_workspace_container(self, *a, **k): return SimpleNamespace(start=lambda: None)
            def write_source(self, *a, **k): pass
            def run_step(self, *a, **k): raise dr.SourceWriteError("short write")
            def remove_container(self, c): self.removed = True
        es._runner = R()
        out = es.execute_submission("python", "print(5)", [SimpleNamespace(input="5\n", expectedOutput="5", returnOutput=True)])
        self.assertEqual((out["status"], out["stderr"], out["passedTests"]), ("execution_error", es.MSG_GENERIC, 0))
        self.assertTrue(es._runner.removed)

    @unittest.skipUnless(shutil.which("sh") and shutil.which("head") and shutil.which("wc"), "POSIX sh/head/wc not available")
    def test_the_real_shell_command_rejects_a_short_write_and_accepts_an_exact_one(self):
        import tempfile, os
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, ".stdin")
            def run(data, n):
                return subprocess.run(["sh", "-c", dr.WRITE_FILE_SCRIPT, "sh", f, str(n)], input=data, capture_output=True).returncode
            self.assertEqual(run(b"12345", 5), 0)
            with open(f, "rb") as fh: self.assertEqual(fh.read(), b"12345")
            self.assertNotEqual(run(b"123", 5), 0, "3 of 5 bytes must fail")
            self.assertNotEqual(run(b"", 5), 0, "0 of 5 bytes must fail")
            self.assertEqual(run(b"1234567", 5), 0)              # extra input is ignored, exactly 5 bytes are kept
            with open(f, "rb") as fh: self.assertEqual(fh.read(), b"12345")

    def test_empty_input_still_uses_the_plain_truncate_command(self):
        cmds = []
        class R(dr.DockerRunner):
            def _exec(self, container, cmd, send, timeout_s, max_output_bytes):
                cmds.append((cmd, send)); return dict(exit_code=0, stdout="", stderr="", timed_out=False, output_truncated=False)
        R().write_source(object(), "main.py", "")
        self.assertEqual(cmds, [(["sh", "-c", ': > "$1"', "sh", "main.py"], None)])


class TimeoutAndTruncationOnTheBufferedPath(unittest.TestCase):
    def test_timeout_still_fires_and_kills_when_reading_through_the_buffer(self):
        released = threading.Event(); killed = []
        sock, reader, wire = handoff(b"", prebuffered=0, blocking=released)
        r, box = runner_for(sock, exit_code=137, killed=killed)
        box.kill = lambda: (killed.append(1), released.set())     # killing the container ends the stream
        t0 = time.monotonic()
        out = r.run_step(box, ["python3", "main.py"], b"", 0.3, 4096)
        self.assertLess(time.monotonic() - t0, 2.5)
        self.assertTrue(out["timed_out"]); self.assertEqual(killed, [1]); self.assertIsNone(out["exit_code"])

    def test_output_cap_still_truncates_and_kills_when_reading_through_the_buffer(self):
        released = threading.Event(); killed = []
        flood = _frame(1, b"x" * 5000) * 5
        sock, reader, wire = handoff(flood, prebuffered=3000, blocking=released)
        r, box = runner_for(sock, killed=killed)
        box.kill = lambda: (killed.append(1), released.set())
        out = r.run_step(box, ["x"], b"", 5, 1000)
        self.assertTrue(out["output_truncated"]); self.assertFalse(out["timed_out"]); self.assertEqual(killed, [1])
        self.assertLessEqual(len(out["stdout"]), 1000)


if __name__ == "__main__":
    unittest.main()
