"""
Real end-to-end smoke test: runs known programs through execute_submission -> DockerRunner -> real Docker, for every
supported language, and checks (a) the status/pass counts and (b) that no sandbox container is left behind.

Needs a reachable Docker daemon and the four language images (python -m app.prepare_images). Uses the SAME code path as
POST /execute, but not the HTTP layer or the API key, so it never needs or prints a secret.

    cd code-executor
    python scripts/smoke_test.py            # all languages
    python scripts/smoke_test.py python java
"""
import faulthandler
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import docker  # noqa: E402
from app.services import execution_service as es  # noqa: E402
from app.services.docker_runner import SANDBOX_LABEL  # noqa: E402
from app.utils.language_config import LANGUAGES  # noqa: E402

T = lambda i, o, flag=True: SimpleNamespace(input=i, expectedOutput=o, returnOutput=flag)  # noqa: E731

PROGRAMS = {
    "python": {
        "ok": 'print(int(input()) + 3)',
        "runtime": 'print(1 / 0)',
        "loop": 'while True:\n    pass',
        "flood": 'print("x" * 5_000_000)',
        "compile": None,
    },
    "javascript": {
        "ok": 'const s = require("fs").readFileSync(0, "utf8"); console.log(parseInt(s) + 3);',
        "runtime": 'throw new Error("boom");',
        "loop": 'while (true) {}',
        "flood": 'console.log("x".repeat(5000000));',
        "compile": None,
    },
    "java": {
        "ok": 'import java.util.*; public class Main { public static void main(String[] a) { System.out.println(new Scanner(System.in).nextInt() + 3); } }',
        "runtime": 'public class Main { public static void main(String[] a) { throw new RuntimeException("boom"); } }',
        "loop": 'public class Main { public static void main(String[] a) { while (true) {} } }',
        "flood": 'public class Main { public static void main(String[] a) { StringBuilder b = new StringBuilder(); for (int i = 0; i < 5000000; i++) b.append("x"); System.out.println(b); } }',
        "compile": 'public class Main { public static void main(String[] a) { int x = ; } }',
    },
    "cpp": {
        "ok": '#include <iostream>\nint main() { int n; std::cin >> n; std::cout << n + 3 << std::endl; }',
        "runtime": 'int main() { return 3; }',
        "loop": 'int main() { volatile int i = 0; while (true) { i = i + 1; } }',
        "flood": '#include <iostream>\nint main() { for (int i = 0; i < 5000000; i++) std::cout << "x"; }',
        "compile": 'int main() { int x = ; }',
    },
}


ISOLATION_PROBE = """
import os, socket
def can(f):
    try:
        f(); return True
    except Exception:
        return False
cap = [l.split()[1] for l in open('/proc/self/status') if l.startswith('CapEff')][0]
print(os.getuid(), can(lambda: open('/etc/x', 'w')), can(lambda: socket.create_connection(('1.1.1.1', 53), timeout=1)), cap)
"""


def sandbox_ids(client):
    """Sandbox containers only, found by the label the runner puts on every one. (An `ancestor=<image>` filter also matches the
    executor service's own container, because its image is built FROM python:3.12.3-slim - that gave false "leftover" reports.)"""
    return {c.id for c in client.containers.list(all=True, filters={"label": SANDBOX_LABEL})}


CASE_CAP_S = 90  # no single check may take longer than this (compile + run + container start, with generous margin)


def run_bounded(fn, cap_s=CASE_CAP_S):
    """Runs fn() in a thread. Returns (result, None), or (None, "HUNG") if it did not finish within cap_s, after printing where
    every thread is stuck. The hung thread is abandoned (daemon) - the smoke test itself must never wait without a bound."""
    box = {}
    t = threading.Thread(target=lambda: box.update(result=fn()), daemon=True, name="smoke-case")
    t.start(); t.join(cap_s)
    if t.is_alive():
        print(f"\n!! check did not finish within {cap_s}s - thread stacks:", flush=True)
        faulthandler.dump_traceback(all_threads=True)
        return None, "HUNG"
    return box.get("result"), None


def remove_new_sandboxes(client, before):
    """After a hang: remove ONLY sandbox containers (by label) created since this run started."""
    for c in client.containers.list(all=True, filters={"label": SANDBOX_LABEL}):
        if c.id not in before:
            try:
                c.remove(force=True); print(f"   removed stuck sandbox container {c.id[:12]}")
            except Exception as exc:
                print(f"   could not remove {c.id[:12]}: {type(exc).__name__}")


def leftover(client, before):
    return sorted(i[:12] for i in sandbox_ids(client) - before)


def main(argv):
    wanted = argv or list(PROGRAMS)
    client = docker.from_env()
    failures = 0
    before = sandbox_ids(client)  # sandbox containers that already existed (not ours to judge)
    for lang in wanted:
        cases = [
            ("success", PROGRAMS[lang]["ok"], [T("2\n", "5")], "completed", 1),
            ("wrong answer", PROGRAMS[lang]["ok"], [T("2\n", "6")], "completed", 0),
            ("runtime failure", PROGRAMS[lang]["runtime"], [T("", "x")], "runtime_error", 0),
            ("timeout", PROGRAMS[lang]["loop"], [T("", "x")], "timeout", 0),
            ("output flood", PROGRAMS[lang]["flood"], [T("", "x")], "output_limit", 0),
        ]
        if PROGRAMS[lang]["compile"]:
            cases.append(("compile failure", PROGRAMS[lang]["compile"], [T("", "x")], "compilation_error", 0))
        for name, src, tests, want_status, want_passed in cases:
            out, hung = run_bounded(lambda: es.execute_submission(lang, src, tests, timeout_ms=1500))
            if hung:
                failures += 1
                print(f"HUNG  {lang:<10} {name:<16} (no result after {CASE_CAP_S}s; the executor's own timeout was 1.5s)")
                remove_new_sandboxes(client, before)
                continue
            gone = not leftover(client, before)
            ok = out["status"] == want_status and out["passedTests"] == want_passed and gone
            failures += 0 if ok else 1
            print(f"{'PASS' if ok else 'FAIL'}  {lang:<10} {name:<16} status={out['status']:<17} passed={out['passedTests']}/{out['totalTests']} "
                  f"containers_left={'none' if gone else leftover(client, before)}" + ("" if ok else f"  stderr={out['stderr'][:120]!r}"))
    if "python" in wanted:  # a program that reads stdin until end-of-file must not hang (no half-close is used)
        out, hung = run_bounded(lambda: es.execute_submission("python", "import sys\nprint(int(sys.stdin.read().split()[0]) + 3)", [T("2\n", "5")], timeout_ms=3000))
        if hung:
            failures += 1; print("HUNG  python     read-until-EOF"); remove_new_sandboxes(client, before); out = None
    if "python" in wanted and out:
        ok = out["status"] == "completed" and out["passedTests"] == 1
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  python     read-until-EOF   status={out['status']} passed={out['passedTests']}/{out['totalTests']}")
    if "python" in wanted:  # sandbox protections as seen from inside a real container: non-root, read-only root, no network, no capabilities
        out, hung = run_bounded(lambda: es.execute_submission("python", ISOLATION_PROBE, [T("", "1000 False False 0000000000000000")], timeout_ms=3000))
        if hung:
            failures += 1; print("HUNG  python     isolation probe"); remove_new_sandboxes(client, before)
            print(f"\n{failures} CHECK(S) FAILED"); return 1
        got = out["tests"][0].get("actualOutput") if out["tests"] else out["stderr"]
        ok = out["status"] == "completed" and out["passedTests"] == 1
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  python     isolation probe  (uid, /etc writable, network, CapEff) -> {got!r}")
    print("\nALL PASSED" if not failures else f"\n{failures} CHECK(S) FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
