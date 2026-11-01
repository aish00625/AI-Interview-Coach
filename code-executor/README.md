# AI Interview Coach — Code Executor (Python / FastAPI + Docker)

Executes submitted source code inside ephemeral, locked-down Docker
containers and returns pass/fail results. Per the project architecture,
**this service never connects to PostgreSQL** — it has no database
credentials and never sees them. It also never talks to React directly;
every request comes from Node's `backend/services/codeExecutorClient.js`,
which is the only thing that calls it.

## Architecture

```text
Node (codingService.js)
  → fetches authoritative test cases from PostgreSQL (never from the browser)
  → POST /execute  (X-Code-Executor-Key)
      → execution_service.py: orchestrates one submission
          → docker_runner.py: creates ONE ephemeral, locked-down container
              → pipe source over exec stdin into the /workspace tmpfs (no host bind mount)
              → exec compile command (if the language needs one)
              → exec run command once per test case, piping that test's input
              → compare stdout to the expected output
          → container removed, always (success, failure, timeout, or exception)
  ← { status, passedTests, totalTests, executionTimeMs, tests: [{index, passed}], stderr }
```

## API

### `GET /health` — no auth
```json
{ "status": "ok", "service": "code-executor" }
```

### `POST /execute` — requires `X-Code-Executor-Key: <key>`
```json
{
  "language": "python",
  "sourceCode": "...",
  "testCases": [{ "input": "5\n3\n", "expectedOutput": "8" }],
  "timeoutMs": 2000
}
```
`testCases` must come from Node (which reads `coding_problems.test_cases`
in PostgreSQL) — this service has no database access of its own and
trusts whatever Node sends it as the authoritative test set for this
request. It does not know or care which test cases are "hidden"; that
distinction is enforced entirely on the Node/response side (see below).

Response:
```json
{
  "status": "completed",
  "passedTests": 1,
  "totalTests": 1,
  "executionTimeMs": 84,
  "memoryUsedKb": null,
  "tests": [{ "index": 1, "passed": true }],
  "stderr": ""
}
```
`tests` is deliberately minimal — index and pass/fail only. There is no
`expectedOutput`, no test input, and no per-test stdout anywhere in this
response, so even if Node forwarded it unchanged to the browser, nothing
here could leak hidden test data. `memoryUsedKb` is `null` in this phase
— see "Known limitations" below.

### Contract v1.1 (Phase I) — optional, backward compatible

A test case may carry `"returnOutput": true`. For **only those tests** the
response adds `actualOutput` (capped at 2000 chars), `stderr` (capped at 1000)
and `durationMs`. Node sets the flag only on *visible* (sample) tests, so hidden
test data and output still never leave the executor. With no flag set, the
response is byte-for-byte the v1.0 shape. `memoryUsedKb` is still `null`:
memory is not measured, and nothing in the UI claims otherwise.
Covered by `tests/test_execution_service.py` against a fake runner; it has not
been run against a real Docker daemon.

## Supported languages

Exactly `python`, `javascript`, `java`, `cpp` — see
`app/utils/language_config.py`, the single source of truth for each
language's Docker image (pinned tag, never `:latest`), source filename,
optional compile command, and run command. Adding a language means
adding one entry there.

| Language | Image | Source file | Compile |
|---|---|---|---|
| python | `python:3.12.3-slim` | `main.py` | — |
| javascript | `node:20.11.1-slim` | `main.js` | — |
| java | `eclipse-temurin:21.0.2_13-jdk-jammy` | `Main.java` | `javac Main.java` |
| cpp | `gcc:13.2.0` | `main.cpp` | `g++ -O2 -std=c++17 -o main main.cpp` |

Java/C++ starter templates (`backend/services/codingStarterTemplates.js`)
were updated in this phase to be full `stdin`/`stdout` programs (a `Main`
class, a `main()` function) rather than bare method stubs — this
execution model runs a complete program and compares its stdout, not a
single function's return value, so the class/file naming had to match
what `language_config.py` compiles and runs.

## Execution statuses

```text
completed          — ran; passedTests/totalTests reflect the actual comparison
compilation_error  — javac/g++ exited non-zero; stderr has the compiler message
runtime_error       — the program exited non-zero on some test
timeout             — exceeded timeoutMs (or the compile step's fixed budget); container was killed
output_limit        — stdout/stderr exceeded MAX_OUTPUT_BYTES; output was truncated
execution_error     — something went wrong in the execution environment itself (not the user's code)
```
Note: **`database/schema.sql`'s `coding_submissions.status` only allows
`pending`/`passed`/`failed`/`error`.** Node maps every status above other
than `completed` down to `error` when persisting (and `completed` to
`passed`/`failed` based on the test counts) — see
`backend/README.md`'s Phase 9 section for the exact mapping. The richer
status above is still returned in the *immediate* API response so the
frontend can show something more specific than "error" right after
submitting, even though only the coarser value is stored.

## Docker container security

Every execution gets a single fresh container (`docker_runner.py`), removed
in a `finally` block no matter how execution ends. That container is
configured with:

- `network_disabled=True`, `network_mode="none"` — no network access
- `mem_limit`, `nano_cpus`, `pids_limit` — bounded memory/CPU/process count (blocks fork bombs)
- `cap_drop=["ALL"]`, `security_opt=["no-new-privileges"]`
- `read_only=True` root filesystem; the only writable path is an
  **in-memory tmpfs at `/workspace`** — never a host bind mount, so
  nothing on the executor's own host filesystem is ever reachable from
  inside the container
- non-root user (`uid 1000`)
- source code streamed over the stdin of a fixed `cat > <fixed filename>` exec, never a host mount, never interpolated into a shell command (`put_archive` is refused by Docker for read-only containers, even into a tmpfs)
- the `/workspace` tmpfs keeps Docker's default `noexec`; only C++ (which must run the binary it just compiled) gets `exec`, and every container stays `nosuid`/`nodev`
- every compile/run command is a fixed argument list from `language_config.py` — never a shell string built from user input

**Never used:** `--privileged`, a Docker-socket mount *inside the
execution containers themselves*, arbitrary host directory mounts, or
host networking.

## Resource limits (configurable, `.env`)

| Limit | Default | Purpose |
|---|---|---|
| `EXECUTION_TIMEOUT_MS` | 2000 | per test case |
| `MEMORY_LIMIT_MB` | 256 | per container |
| `CPU_LIMIT_CORES` | 0.5 | fraction of one core |
| `PIDS_LIMIT` | 64 | blocks fork bombs |
| `MAX_OUTPUT_BYTES` | 65536 (64 KB) | per stream, stdout/stderr each |
| `MAX_SOURCE_CODE_BYTES` | 51200 (50 KB) | rejected before any container is created |
| `MAX_TEST_CASES` | 20 | hard cap, even if Node somehow sent more |
| `WORKSPACE_TMPFS_SIZE` | 64m | the in-memory `/workspace` |

These are **development safety defaults, not production-tuned values** —
re-evaluate all of them (especially memory/CPU/timeout) against your
actual host capacity and expected load before any real deployment.

## Execution lifecycle & cleanup

1. Validate language + source size; cap test case count.
2. Create one idle container (`sleep infinity`), write the source file.
3. If the language compiles: exec the compile command with its own fixed
   10-second budget. Non-zero exit → `compilation_error`; timeout →
   `timeout`. Either way, execution stops here.
4. For each test case: exec the run command, piping that test's `input`
   to stdin, with a per-test-case timeout and output cap. A timeout kills
   the container immediately (a hung process can't otherwise be
   cancelled cleanly) and no further test cases run.
5. Compare trimmed stdout to the trimmed expected output for each
   completed test case.
6. **Always**, in a `finally` block: remove the container — regardless of
   which of the above paths was taken, including an unhandled exception.

## Known limitations

- **Memory usage is not measured** — `mem_limit` is enforced (the
  container is killed by Docker if it exceeds it, which surfaces as a
  non-zero exit / `runtime_error`), but `memoryUsedKb` in the response is
  always `null`. Reliable per-exec memory sampling would need polling
  `container.stats()` concurrently with each test case, which wasn't
  implemented in this phase.
- **This has not been runtime-tested** — see the note in the top-level
  final report. The logic was written carefully against the Docker SDK's
  documented API (including its raw multiplexed-stream exec protocol for
  piping stdin/reading stdout+stderr with a timeout), but it has not
  actually been run against a live Docker daemon in this environment.
  Test it against real Docker before trusting it with real submissions.

## Setup

```bash
cd code-executor
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Requires a reachable Docker daemon — see "Production hardening" below
# for why mounting the host's Docker socket is a development-only choice.
uvicorn app.main:app --reload --port 9000
```

## Language images, diagnostics and troubleshooting

Each language runs in the pinned image from `app/utils/language_config.py` (`python:3.12.3-slim`, `node:20.11.1-slim`,
`eclipse-temurin:21.0.2_13-jdk-jammy`, `gcc:13.2.0`). The Docker SDK's `containers.create()` **does not pull** missing images,
so they must exist on the Docker host:

- On start, the service pulls any missing image in the background (disable with `EXECUTOR_PREPULL=false`). The first pull is
  large (~2 GB in total); until an image arrives, submissions in that language return `execution_error` with
  "The code runtime is still being prepared...", and a failed pull returns "...could not be prepared..." (30 s retry back-off).
- Pull on demand: `docker compose --profile executor exec code-executor python -m app.prepare_images`
  (or `docker pull` each tag above).
- `GET /runtimes` (needs `X-Code-Executor-Key`) reports whether Docker is reachable and each language image's state.
- Real details of any failure are in the executor log (`docker compose --profile executor logs code-executor`): exception type and a
  short message only, never source code, keys or stack traces in API responses.
- `execution_error` texts: "Execution environment error." (unexpected), "...still being prepared..." / "...could not be prepared..."
  (image), "...cannot reach Docker..." (daemon unreachable).

Real-Docker smoke test (all four languages: success, wrong answer, runtime error, timeout, output flood, compile error,
leftover-container check, isolation probe): `python scripts/smoke_test.py` (or name languages: `python scripts/smoke_test.py cpp`).

## Production hardening (not implemented here — documented, not built)

This phase implements the isolation controls above, appropriate for a
local/development setup where this service can reach a Docker daemon
(typically via the host's Docker socket during development). That socket
grants effectively root-equivalent access to the host to whatever can
reach it, so a real deployment should additionally consider:

- Running this service against a dedicated, network-isolated
  Docker-in-Docker host or a container sandboxing runtime with stronger
  isolation than default containers (e.g. gVisor, Kata Containers,
  Firecracker microVMs) instead of a shared host Docker socket.
- Never exposing this service, its port, or its API key to anything
  other than the Node backend on a private network.
- Rotating `CODE_EXECUTOR_API_KEY` and serving this service over TLS
  between Node and the executor in any non-local deployment.
- Rate-limiting / concurrency-limiting executions per user to prevent
  resource-exhaustion via many simultaneous submissions.
- Periodic cleanup of any container/image left behind by a crash of this
  service itself (the code here always removes its own containers, but a
  hard process kill mid-execution could still orphan one).
