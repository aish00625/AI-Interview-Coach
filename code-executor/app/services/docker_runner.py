"""
Low-level, isolated container lifecycle management via the Docker SDK.

SECURITY DESIGN (see code-executor/README.md for the full checklist):
  - one fresh ephemeral container per submission, always removed in a
    `finally` block (success, compile failure, runtime failure, timeout,
    or exception all clean up the same way)
  - network_disabled + network_mode="none" — no network access at all
  - mem_limit / nano_cpus / pids_limit — bounded resources, blocks both
    memory exhaustion and fork-bomb-style attacks
  - cap_drop=["ALL"] + security_opt=["no-new-privileges"] — minimal Linux capabilities
  - read_only root filesystem; the only writable path is an in-memory
    tmpfs at /workspace (NOT a host bind mount — nothing on the host
    filesystem is ever exposed to the container)
  - non-root user (uid 1000) inside the container
  - source code is streamed into the workspace over the stdin of a fixed
    `exec` (`cat > <fixed filename>`): never a host bind mount, never
    interpolated into a shell command. (`put_archive` cannot be used: the
    Docker Engine refuses archive uploads to a container whose root
    filesystem is read-only, even when the target is a writable tmpfs.)
    Every command run inside the container is a fixed argument list from
    language_config.py; the submitted code only ever travels as stdin data

This module never runs submitted code outside Docker, and never passes
submitted code through a shell. All communication with the container
after creation uses the Docker Engine API via the `docker` SDK.
"""
import logging
import os
import socket
import threading
import time
from typing import List, Optional

import docker
from docker.errors import DockerException, ImageNotFound

WRITE_TIMEOUT_S = 5
DOCKER_API_TIMEOUT_S = int(os.getenv("DOCKER_API_TIMEOUT_S", "30"))
KILL_GRACE_S = 3.0  # how long to wait for the stream to end after the container is killed
log = logging.getLogger("code_executor.runner")


def _cmd_label(cmd):
    """A short, safe label for logs: what kind of step this is, or the program name. Never arguments or source code."""
    if cmd and cmd[0] == "sh" and len(cmd) > 2:
        if cmd[2].startswith(("head -c", ": >")):
            return "write-file"
        if cmd[2].startswith("exec") and len(cmd) > 4:
            return cmd[4]
    return cmd[0] if cmd else "?"


SANDBOX_LABEL = "aic.code-executor.sandbox"
STDIN_FILE = ".stdin"
# Fixed write command ($1 = file name, $2 = byte count): copy exactly N bytes from stdin, then fail unless the file
# really holds N bytes. Arguments only ever come from this module; the data travels on stdin.
WRITE_FILE_SCRIPT = 'head -c "$2" > "$1" && [ "$(wc -c < "$1")" -eq "$2" ]'
EXIT_CODE_WAIT_S = 2.0


class SourceWriteError(Exception):
    """The submission's source file could not be placed in the sandbox (an environment problem, not the user's)."""


def _truncate(data: bytes, max_bytes: int):
    truncated = len(data) > max_bytes
    text = data[:max_bytes].decode("utf-8", errors="replace")
    return text, truncated


NPIPE_ENDED = 109  # Windows ERROR_BROKEN_PIPE: how a closed Docker named pipe reports end-of-stream


def _recv(sock, n: int) -> bytes:
    """
    One read from the Docker stream socket. Docker Desktop on Windows talks over a named pipe (docker-py's
    NpipeSocket), which reports the server closing the stream as a pywin32 error 109 instead of a 0-byte read.
    docker-py's own reader treats it as EOF; so do we.
    """
    try:
        return sock.recv(n)
    except (socket.timeout, TimeoutError):
        raise
    except RuntimeError:
        raise  # "Can not reuse socket after connection was closed": a bug in our use of the socket - never mask it
    except Exception as exc:
        if getattr(exc, "args", None) and exc.args[0] == NPIPE_ENDED:
            return b""
        raise


def _recv_exact(sock, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = _recv(sock, n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


def _buffered_reader(sock):
    """
    The BufferedReader that http.client used to parse the exec's HTTP upgrade response, if it sits directly on `sock`.
    docker-py's exec_start(socket=True) hands back the raw stream UNDER that reader (`response.raw._fp.fp.raw`), so any
    output that arrived in the same read as the response headers is held in the reader's buffer and is invisible to the
    raw socket: a program's output could come back empty or missing its start while its exit code still said 0.
    Returns None when there is no usable reader - the Windows named pipe (docker-py hands back `fp.raw.sock`, not
    `fp.raw`), a missing or closed response, or test doubles - and the caller then reads the raw socket as before.
    """
    response = getattr(sock, "_response", None)
    reader = getattr(getattr(getattr(response, "raw", None), "_fp", None), "fp", None)
    if reader is None or getattr(reader, "raw", None) is not sock or getattr(reader, "closed", True):
        return None
    if not callable(getattr(reader, "read1", None)):
        return None
    return reader


class _ExecStream:
    """One exec's stream: reads drain the response's buffered reader first (then continue on the same socket), writes
    and close go to the raw socket exactly as before. Without a buffered reader every call goes to the raw socket."""

    def __init__(self, sock):
        self.raw = getattr(sock, "_sock", sock)
        self._reader = _buffered_reader(sock)

    @property
    def buffered(self) -> bool:
        return self._reader is not None

    def recv(self, n: int) -> bytes:
        return self._reader.read1(n) if self._reader is not None else self.raw.recv(n)

    def sendall(self, data: bytes):
        self.raw.sendall(data)

    def close(self):
        self.raw.close()


class DockerRunner:
    """Thin, testable wrapper around the pieces of the Docker SDK this service needs."""

    def __init__(self):
        self._client = None  # lazy — importing/instantiating this module must not require Docker to be running

    def _get_client(self):
        if self._client is None:
            self._client = docker.from_env(timeout=DOCKER_API_TIMEOUT_S)  # bounds every ordinary (non-streaming) API call
        return self._client

    def create_workspace_container(self, image: str, cpu_cores: float, memory_mb: int,
                                    pids_limit: int, tmpfs_size: str, allow_exec: bool = False):
        """
        Creates (but does not start) an idle, locked-down container. The
        entrypoint is `sleep infinity` so compile/run steps happen via
        `exec` afterward — this lets one container serve the compile step
        plus every test case for a submission, instead of paying the
        compile cost (for Java/C++) once per test case.

        Docker mounts a tmpfs `noexec` by default. That is kept for languages that only READ files from the workspace
        (Python, JavaScript, Java). `allow_exec=True` adds the `exec` mount option for the one case that must run a
        binary it just compiled there (C++ -> ./main). Still nosuid/nodev, still no network, no capabilities,
        no-new-privileges, non-root, read-only root.
        """
        tmpfs_opts = f"size={tmpfs_size},uid=1000,gid=1000,mode=1777" + (",exec" if allow_exec else "")
        client = self._get_client()
        log.info("creating sandbox container from %s", image)
        container = client.containers.create(
            image=image,
            command=["sleep", "infinity"],
            detach=True,
            network_disabled=True,
            network_mode="none",
            mem_limit=f"{memory_mb}m",
            nano_cpus=int(cpu_cores * 1_000_000_000),
            pids_limit=pids_limit,
            security_opt=["no-new-privileges"],
            cap_drop=["ALL"],
            read_only=True,
            tmpfs={"/workspace": tmpfs_opts},
            working_dir="/workspace",
            user="1000:1000",
            # The root filesystem is read-only, so tools that default to /tmp or $HOME (g++ and its assembler/linker
            # temp files, the JVM) would fail. Point them at the existing in-memory /workspace tmpfs. This adds no
            # writable path and weakens no isolation control.
            environment={"TMPDIR": "/workspace", "HOME": "/workspace"},
            stdin_open=False,
            tty=False,
            labels={SANDBOX_LABEL: "1"},  # lets tooling find sandbox containers exactly (an image-ancestor filter also matches the executor itself)
        )
        log.info("created sandbox container %s", str(getattr(container, "id", "?"))[:12])
        return container

    def _put_file(self, container, filename: str, data: bytes):
        """
        Writes exactly `len(data)` bytes into /workspace/<filename> (a path under the tmpfs) via a fixed
        `head -c N > file` exec fed over stdin. `head -c N` stops by itself after N bytes, so no end-of-input
        signal (a half-closed socket) is required - Docker Desktop's Windows named pipe cannot half-close: its
        `shutdown()` closes the whole connection, which is what caused "Can not reuse socket after connection was
        closed". `filename` comes from language_config.py / this class, never from the user; the content is only data.

        `head -c N` also exits 0 when its input ends early, so the command then checks that the file holds exactly N
        bytes. A short write (a dropped stream, a failed send) therefore fails here with SourceWriteError instead of
        running the program on incomplete input.
        """
        if not data:
            result = self._exec(container, ["sh", "-c", ': > "$1"', "sh", filename], None, WRITE_TIMEOUT_S, 1024)
        else:
            result = self._exec(container, ["sh", "-c", WRITE_FILE_SCRIPT, "sh", filename, str(len(data))],
                                data, WRITE_TIMEOUT_S, 1024)
        if result["timed_out"] or result["exit_code"] != 0:
            raise SourceWriteError("Could not write a file into the sandbox workspace.")

    def write_source(self, container, filename: str, source_code: str):
        """Places the submitted source file in the /workspace tmpfs (no host bind mount, not part of any command)."""
        self._put_file(container, filename, source_code.encode("utf-8"))

    def image_exists(self, image: str) -> bool:
        try:
            self._get_client().images.get(image)
            return True
        except ImageNotFound:
            return False

    def pull_image(self, image: str):
        """Pulls `image` ("repo:tag"). containers.create() never pulls on its own, so this must be explicit."""
        repository, _, tag = image.rpartition(":")
        self._get_client().images.pull(repository, tag=tag)

    def ping(self) -> bool:
        return bool(self._get_client().ping())

    def run_step(self, container, cmd: List[str], stdin_data: bytes, timeout_s: float, max_output_bytes: int):
        """
        Runs the fixed argument list `cmd` in the (already-running) container, with `stdin_data` as the program's
        standard input, a wall-clock timeout and a byte cap on captured output. The input is first placed in
        /workspace/.stdin and the program is started as `exec "$@" < .stdin` (or /dev/null when there is none), so the
        program always sees a proper end-of-file without the exec stream needing a half-close (see _put_file).
        On timeout (or runaway output) the whole container is killed, so callers must not reuse it afterwards.

        Returns: { exit_code, stdout, stderr, timed_out, output_truncated }
        """
        if stdin_data:
            self._put_file(container, STDIN_FILE, stdin_data)
            redirect = f"< {STDIN_FILE}"
        else:
            redirect = "< /dev/null"
        return self._exec(container, ["sh", "-c", f'exec "$@" {redirect}', "sh", *cmd], None, timeout_s, max_output_bytes)

    def _exec(self, container, cmd: List[str], send: Optional[bytes], timeout_s: float, max_output_bytes: int):
        """
        One low-level exec. `send` (optional) is written to the process's stdin; the stream is never half-closed.

        The socket I/O runs in a worker thread and THIS thread enforces the deadline. A socket timeout cannot be relied on:
        docker-py's Windows named-pipe socket ignores `settimeout()` (its reads are plain blocking ReadFile calls), so a
        program that prints nothing and never exits (`while True: pass`) would block `recv()` forever and the timeout would
        never fire. On timeout, or once the output cap is exceeded, the container is killed - that ends the stream and
        unblocks the worker - and a worker that still does not finish is abandoned (daemon thread) rather than waited on.
        """
        client = self._get_client()
        api = client.api
        cid = container.id[:12]
        started = time.monotonic()
        log.info("exec %s: create (container %s)", _cmd_label(cmd), cid)
        exec_id = api.exec_create(
            container.id, cmd, stdin=send is not None, stdout=True, stderr=True, workdir="/workspace",
        )["Id"]
        stream = _ExecStream(api.exec_start(exec_id, socket=True, stream=False))
        log.info("exec %s: stream open (%s), waiting up to %.1fs (container %s)", _cmd_label(cmd),
                 "buffered" if stream.buffered else "raw", timeout_s, cid)

        state = {"out": [], "err": [], "total": 0, "exceeded": False, "error": None}
        done = threading.Event()

        def pump():
            try:
                if send is not None:
                    try:
                        stream.sendall(send)
                    except OSError:
                        pass  # the process may have exited early; _put_file's byte-count check catches a short write
                while True:
                    header = _recv_exact(stream, 8)  # Docker's multiplexed stream frame header
                    if not header or len(header) < 8:
                        return
                    length = int.from_bytes(header[4:8], "big")
                    payload = _recv_exact(stream, length) if length else b""
                    (state["err"] if header[0] == 2 else state["out"]).append(payload)  # 1 = stdout, 2 = stderr
                    state["total"] += len(payload)
                    if state["total"] > max_output_bytes:
                        state["exceeded"] = True
                        return
            except BaseException as exc:  # reported to the caller thread below; never lost
                state["error"] = exc
            finally:
                done.set()

        worker = threading.Thread(target=pump, daemon=True, name="exec-pump")
        worker.start()
        finished = done.wait(timeout_s)
        timed_out = not finished
        exceeded = state["exceeded"]

        if timed_out or exceeded:
            log.info("exec %s: %s after %dms - killing container %s", _cmd_label(cmd),
                     "timeout" if timed_out else "output cap reached", int((time.monotonic() - started) * 1000), cid)
            try:
                container.kill()  # only this exec's own sandbox container
            except Exception as exc:
                log.info("kill of container %s: %s (already stopped?)", cid, type(exc).__name__)
            if not done.wait(KILL_GRACE_S):
                log.error("exec %s: stream still blocked %.0fs after kill; abandoning the reader (container %s)", _cmd_label(cmd), KILL_GRACE_S, cid)
        try:
            stream.close()
        except Exception:
            pass

        err = state["error"]
        if err is not None and not (timed_out or exceeded):
            # Never swallowed: a stream that failed part-way may have delivered only some of the program's output, and
            # grading that would turn an environment problem into a wrong answer. Callers already classify OSError /
            # DockerException as an environment error (execution_error); a RuntimeError such as "Can not reuse socket
            # after connection was closed" is a bug in how the socket is used and is raised as-is too.
            log.error("exec %s: reading the stream failed: %s (container %s)", _cmd_label(cmd), type(err).__name__, cid)
            raise err

        exit_code = None
        if not timed_out and not exceeded:
            # The stream can close a moment before the daemon records the exit status: poll briefly instead of
            # treating "not recorded yet" as a failure.
            deadline = time.monotonic() + EXIT_CODE_WAIT_S
            while True:
                try:
                    info = api.exec_inspect(exec_id)
                except Exception:
                    break
                if not info.get("Running") and info.get("ExitCode") is not None:
                    exit_code = info["ExitCode"]
                    break
                if time.monotonic() >= deadline:
                    break
                time.sleep(0.02)

        stdout_text, stdout_trunc = _truncate(b"".join(state["out"]), max_output_bytes)
        stderr_text, stderr_trunc = _truncate(b"".join(state["err"]), max_output_bytes)
        log.info("exec %s: finished in %dms exit=%s timed_out=%s truncated=%s (container %s)", _cmd_label(cmd),
                 int((time.monotonic() - started) * 1000), exit_code, timed_out, stdout_trunc or stderr_trunc or exceeded, cid)
        return {
            "exit_code": exit_code,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "timed_out": timed_out,
            "output_truncated": stdout_trunc or stderr_trunc or exceeded,
        }

    def remove_container(self, container):
        """Always safe to call, even on an already-killed/removed container — every caller does this in a finally block."""
        cid = str(getattr(container, "id", ""))[:12]
        try:
            container.remove(force=True)
            log.info("removed sandbox container %s", cid)
        except Exception as exc:
            log.warning("could not remove sandbox container %s: %s", cid, type(exc).__name__)
