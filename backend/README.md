# AI Interview Coach — Backend (Node.js / Express)

This service owns all PostgreSQL access and is the only thing the React
frontend, the Python AI service, and the code-execution service talk
through — see `docs/phase1-architecture.md` in the project root for the
full picture.

## Module system

CommonJS (`require` / `module.exports`), not ES Modules. Reasoning:

- No extra `"type": "module"` config or `.mjs` juggling — one less thing
  to explain to a student debugging their first Node error.
- Every popular Express tutorial, and most `pg`/`express-validator`
  examples you'll find, are written in CommonJS — easier to cross-reference.
- Avoids top-level `await` / dynamic `import()` edge cases that ESM
  introduces for a project this size, with no real benefit here.

## Environment configuration

```text
PORT=5000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:password@localhost:5432/ai_interview_coach
FRONTEND_URL=http://localhost:5173
AI_SERVICE_URL=http://localhost:8000
CODE_EXECUTOR_URL=http://localhost:9000
AI_SERVICE_API_KEY=change-me
CODE_EXECUTOR_API_KEY=change-me
JWT_SECRET=replace_with_a_real_secret
JWT_EXPIRES_IN=7d
```

1. Copy the template: `cp .env.example .env`
2. Replace the username/password/host/port in `DATABASE_URL` with your
   actual local PostgreSQL credentials.
3. Never commit `.env` — it's already excluded via `.gitignore`. Generate
   your own values for `JWT_SECRET`, `AI_SERVICE_API_KEY`, and
   `CODE_EXECUTOR_API_KEY` — the ones above are placeholders, not real
   secrets. `AI_SERVICE_API_KEY` must match `ai-service/.env` exactly;
   `CODE_EXECUTOR_API_KEY` must match `code-executor/.env` exactly.

## PostgreSQL setup

PostgreSQL must be installed and running locally before any endpoint
beyond `/api/health` will work.

1. Create the database:
   ```sql
   CREATE DATABASE ai_interview_coach;
   ```
   (run this from `psql -U postgres`, or any client connected to your
   Postgres server)

2. Load the schema — from the **project root** (one level above `backend/`):
   ```bash
   psql -U postgres -d ai_interview_coach -f database/schema.sql
   ```
   If you're running the command from inside `backend/` instead, use
   `-f ../database/schema.sql`.

   This creates all 12 Phase 1 tables — `users`, `profiles`, `skills`,
   `topics`, `user_skills`, `interview_sessions`, `interview_questions`,
   `interview_answers`, `coding_problems`, `coding_submissions`,
   `performance_scores`, `recommended_questions` — and inserts the initial
   topic and skill seed rows. Nothing in the Node app re-creates or
   re-seeds this data; `schema.sql` is the only place it comes from.

3. Make sure `backend/.env`'s `DATABASE_URL` (from the section above)
   points at that database with the right user/password/host/port.

4. Connect and verify the tables loaded:
   ```bash
   psql -U postgres -d ai_interview_coach
   ```
   ```sql
   \dt
   ```
   You should see all 12 tables listed above.

5. Confirm the seed data loaded (still inside the `psql` session):
   ```sql
   SELECT * FROM topics;
   SELECT * FROM skills;
   ```
   These return the seed rows inserted by `schema.sql` — not duplicated
   here since they're already listed there.

## Installation & running

```bash
cd backend
npm install
npm run dev
```

The backend runs on `http://localhost:5000` (or whatever `PORT` you set
in `.env`).

## Authentication (Phase 5)

### Architecture

```text
Register:  React → Node/Express → validate → check email uniqueness →
           bcrypt.hash() → INSERT users + profiles (one transaction) →
           sign JWT → { token, user }

Login:     React → Node/Express → validate → find user by email →
           bcrypt.compare() → sign JWT → { token, user }

Protected: React (Authorization: Bearer <token>) → requireAuth middleware
           (jwt.verify → req.user = { userId, email }) → controller,
           always scoped to req.user.userId — never a client-supplied id
```

`middleware/auth.js`'s `requireAuth` replaces the Phase 3 placeholder. It
verifies the token and attaches `{ userId, email, iat, exp }` to
`req.user`; every protected controller reads `req.user.userId`, never an
id from the query string or request body, so one user can never read or
write another user's data by changing an id in the URL.

### Passwords & JWTs

- Passwords are hashed with `bcryptjs` (10 salt rounds) before ever
  touching the database — `password_hash` is never returned in any
  response, and plaintext passwords are never logged or stored.
- JWTs are signed with `JWT_SECRET` (from `.env`, never committed) and
  contain only `{ userId, email }` — no password, no profile data. Treat
  the payload as readable-but-not-writable by the client: JWTs are
  signed, not encrypted, so nothing sensitive goes in the payload.
- `JWT_EXPIRES_IN` (default `7d`) controls how long a token is valid.
  There's no server-side session/blacklist — logout is purely a
  client-side token removal, which is sufficient for a stateless JWT
  scheme at this stage.

### Protected endpoints (require `Authorization: Bearer <token>`)

```text
GET  /api/users/profile
PUT  /api/users/profile
GET  /api/interviews
GET  /api/interviews/:id
POST /api/interviews            (still 501 — Phase 6)
POST /api/interviews/:id/answer(/audio)  (still 501 — Phase 6/7/10)
POST /api/interviews/:id/complete        (still 501 — Phase 6)
GET  /api/coding/submissions
POST /api/coding/run            (still 501 — Phase 9)
POST /api/coding/submit         (still 501 — Phase 9)
GET  /api/dashboard             (still 501 — Phase 12)
GET  /api/performance           (still 501 — Phase 12)
```

A missing/invalid/expired token on any of these returns `401` before the
controller ever runs. `GET /api/interviews/:id` additionally checks that
the session's `user_id` matches `req.user.userId` — a mismatch returns
`404` (not `403`), so the response doesn't even confirm the id belongs to
someone else. `GET /api/coding/problems` and `GET /api/coding/problems/:id`
stay public (browsing problems isn't user-specific).

### Example requests

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe","email":"jane@example.com","password":"password123"}'
```
```json
{ "success": true, "data": { "token": "eyJ...", "user": { "id": 1, "name": "Jane Doe", "email": "jane@example.com" } } }
```

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"password123"}'
```

```bash
curl http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer eyJ..."
```

Wrong password or unknown email both return the same generic message —
the API never reveals which one it was:
```json
{ "success": false, "message": "Invalid email or password." }
```

### Frontend token storage

The JWT is stored in `localStorage` under the key `authToken` (see
`TOKEN_STORAGE_KEY` in `frontend/src/services/api.js`) — nothing else is
stored there (no password, no profile data). A production deployment
might prefer an httpOnly cookie instead, which avoids exposing the token
to JavaScript at all; that would change how the token is attached to
requests (the browser sends it automatically) and how logout works
(the server would need to clear the cookie), but wouldn't change
`AuthContext`'s public shape.



### Health checks

`/api/health` checks that the Express application itself is up — no
database involved. `/api/health/db` is the only endpoint that actually
checks PostgreSQL connectivity.

```bash
curl http://localhost:5000/api/health
```
```json
{ "success": true, "message": "AI Interview Coach API is running" }
```

```bash
curl http://localhost:5000/api/health/db
```
```json
{ "success": true, "message": "Database connection successful" }
```
If PostgreSQL isn't running or `DATABASE_URL` is wrong, this returns
HTTP 503 with `{ "success": false, "message": "Database connection failed" }`
— the rest of the API (including `/api/health`) keeps working.

### Lookup tables

```bash
curl http://localhost:5000/api/skills
curl http://localhost:5000/api/topics
```
Both return the seed data from `schema.sql`.

### Coding problems

```bash
curl http://localhost:5000/api/coding/problems
curl "http://localhost:5000/api/coding/problems?difficulty=easy"
curl "http://localhost:5000/api/coding/problems?topic=Arrays"
curl http://localhost:5000/api/coding/problems/1
```
`schema.sql` only seeds topics/skills, not sample coding problems — insert
a row yourself to test these against real data:
```sql
INSERT INTO coding_problems (title, description, difficulty, test_cases)
VALUES ('Two Sum', 'Return indices of two numbers that add up to target.', 'easy', '[]');
```

### Interviews, profile, and coding submissions — require a real login

`GET`/`PUT /api/users/profile`, all 5 interview endpoints, and
`GET /api/coding/submissions` require a valid JWT in the `Authorization`
header — the current user comes from the verified token
(`req.user.userId`), never from a query parameter. See the Authentication
section above for the full register/login flow.

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl http://localhost:5000/api/users/profile -H "Authorization: Bearer $TOKEN"

curl -X PUT http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetRole":"Full Stack Developer","experienceLevel":"fresher","preferredLanguage":"javascript","skillNames":["React","SQL"]}'

# Create an interview session (generates its questions in the same transaction)
SESSION=$(curl -s -X POST http://localhost:5000/api/interviews \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"interviewType":"technical","targetRole":"Software Engineer","difficulty":"medium"}')
echo "$SESSION" | python3 -m json.tool

SESSION_ID=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['session']['id'])")
QUESTION_ID=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['questions'][0]['id'])")

curl http://localhost:5000/api/interviews -H "Authorization: Bearer $TOKEN"
curl http://localhost:5000/api/interviews/$SESSION_ID -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:5000/api/interviews/$SESSION_ID/answer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"questionId\":$QUESTION_ID,\"answerText\":\"My answer to this question.\"}"
# → { "answer": {...}, "nextQuestion": {...} | null, "sessionComplete": true|false }

# Repeat the answer call above for each returned nextQuestion until sessionComplete is true, then:
curl -X POST http://localhost:5000/api/interviews/$SESSION_ID/complete -H "Authorization: Bearer $TOKEN"

curl http://localhost:5000/api/coding/submissions -H "Authorization: Bearer $TOKEN"

# Submit code for execution (Phase 9 — actually runs it in Docker; requires
# the code-executor service to be running, and the problem to have
# test_cases seeded — schema.sql only seeds topics/skills, not problems)
SUBMISSION=$(curl -s -X POST http://localhost:5000/api/coding/submissions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"problemId":1,"language":"python","sourceCode":"print(input())"}')
echo "$SUBMISSION" | python3 -m json.tool
SUBMISSION_ID=$(echo "$SUBMISSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
# → status is "passed"/"failed"/"error" (never still "pending" unless the
#   executor itself was unreachable, in which case this call returns 503
#   instead and the row stays "pending")

curl http://localhost:5000/api/coding/submissions/$SUBMISSION_ID -H "Authorization: Bearer $TOKEN"
# → shows the persisted status/test_cases_passed/test_cases_total/execution_time_ms
#   (the richer executionStatus/tests/stderr fields are only in the immediate
#   POST response, not persisted — see the Phase 9 section above)
```

Calling any of these without the header (or with an expired/invalid token)
returns `401`:
```json
{ "success": false, "message": "Authentication required." }
```

Answering the same question twice, or completing an already-completed
session, returns `409` rather than a raw database error:
```json
{ "success": false, "message": "This question has already been answered." }
```


## Interview Module (Phase 6)

### Flow

```text
POST /api/interviews
  → generate 5 questions from a local question bank (interviewQuestionService.js)
  → INSERT interview_sessions + INSERT interview_questions, one transaction
  → return { session, questions }

POST /api/interviews/:id/answer
  → verify session ownership + question belongs to session
  → reject if this question already has an answer (409)
  → score the answer with the PLACEHOLDER evaluator (interviewEvaluationService.js)
  → INSERT interview_answers
  → find the next unanswered question by order_index
  → return { answer, nextQuestion, sessionComplete }

POST /api/interviews/:id/complete
  → verify ownership, reject if already completed (409)
  → final_score = average across questions of (technical+relevance+clarity+completeness)/4
  → UPDATE interview_sessions: status='completed', completed_at=now(), final_score
```

### Deterministic question generation — NOT AI

`services/interviewQuestionService.js` selects up to 5 questions from a
small local bank (technical/behavioral/hr, tagged with difficulty and an
optional `topics` row) based on `interviewType` and `difficulty`.
Selection is stable/deterministic (bank order), not random and not
AI-generated. `targetRole` is accepted in the function signature for
Phase 7 to use, but this simple bank doesn't yet differentiate by role.

### Placeholder evaluation — NOT AI

`services/interviewEvaluationService.js` scores every answer using only
answer length (word count) — it does not read or judge the actual
content. Every piece of feedback text it returns says "placeholder" so
it can never be mistaken for real AI analysis. **Phase 7 replaces this
evaluator with the Python AI service; the function signature and the
shape of what it returns stay the same, so nothing calling it needs to
change.**

### Final score formula (temporary, Phase 6)

```text
question score = (technical_score + relevance_score + clarity_score + completeness_score) / 4
final_score    = average(question score) across all answered questions, rounded to 2 decimals
```

### Ownership

Every interview endpoint requires a JWT (`requireAuth`) and scopes every
query to `req.user.userId` — never a client-supplied id.
`GET /api/interviews/:id` and answer submission both verify the session's
`user_id` matches the caller before returning or accepting anything; a
mismatch is a `404`, not a `403`, so the response never confirms an id
belongs to someone else.

### Endpoints

```text
POST /api/interviews              create a session + generate its questions
GET  /api/interviews              list the caller's own sessions (optional ?status, ?interviewType filters)
GET  /api/interviews/:id          session + questions + answer status/answers (ownership-checked)
POST /api/interviews/:id/answer   submit an answer to one question (rejects duplicates with 409)
POST /api/interviews/:id/complete calculate final_score and mark the session completed
```



| Error | Cause / fix |
|---|---|
| `ECONNREFUSED` | PostgreSQL isn't running, or is listening on a different host/port than `DATABASE_URL` says. Start Postgres and double-check the host/port. |
| `password authentication failed for user "..."` | The username/password in `DATABASE_URL` don't match your local PostgreSQL credentials. Update `.env`. |
| `database "ai_interview_coach" does not exist` | You haven't run `CREATE DATABASE ai_interview_coach;` yet — see PostgreSQL setup, step 1. |
| `relation "users" does not exist` (or any other table) | The database exists but `schema.sql` hasn't been applied yet — see PostgreSQL setup, step 2. |
| `Cannot find module '...'` | Dependencies aren't installed. Run `npm install` inside `backend/`. |
| `EADDRINUSE: address already in use :::5000` | Something else is already using port 5000. Stop that process or change `PORT` in `.env`. |

## AI Service integration (Phase 7)

A separate Python FastAPI service (`ai-service/`, sibling to `backend/`)
now performs real answer evaluation, replacing the Phase 6 placeholder.
It is a **local NLP-based semantic and concept-matching evaluator — not
an LLM** (see "Evaluation methodology" below), and it is completely
**stateless**: it holds no data between requests and keeps no database
connection of its own. **Node remains the only service that accesses
PostgreSQL — Python never connects to the database, directly or
indirectly.** See `ai-service/README.md` for the service's own setup and
full methodology; this section covers the Node side of the integration.

### Python endpoints

```text
GET  /health    → { "status": "ok", "service": "ai-service" }   (no auth)
POST /evaluate  → the evaluation described below                (requires X-AI-Service-Key)
```

### Flow

```text
POST /api/interviews/:id/answer
  → interviewService.submitAnswer() (same ownership/duplicate checks as Phase 6)
  → aiServiceClient.evaluateAnswer({ questionText, answerText, targetRole, difficulty, interviewType })
  → HTTP POST http://<AI_SERVICE_URL>/evaluate  (header: X-AI-Service-Key)
  → Python: local NLP concept-matching + TF-IDF evaluation (NOT an LLM — see ai-service/README.md)
  → validated JSON response
  → INSERT interview_answers (same columns as Phase 6: technical_score, relevance_score,
     clarity_score, completeness_score, strengths, weaknesses, suggested_improvement, model_answer)
  → next-question / sessionComplete logic unchanged from Phase 6
```

`services/interviewEvaluationService.js` (the Phase 6 length-based
placeholder) has been **removed** — there is now exactly one evaluation
path, not two competing ones. `services/aiServiceClient.js` is the only
thing that calls Python, and `interviewService.js` is the only thing
that calls `aiServiceClient`.

### Evaluation methodology (in Python — summarized here, full detail in `ai-service/README.md`)

- **Concept matching**: the incoming question is matched (by keyword
  overlap, not exact string equality) against a small local reference
  bank; if found, `technicalScore` is the percentage of that reference's
  key concepts present in the answer text.
- **TF-IDF / semantic similarity**: `relevanceScore` blends TF-IDF
  cosine similarity (answer vs. question+concepts) with concept
  coverage — pure TF-IDF on short answer texts is noisy on its own.
- **Completeness**: blend of concept coverage and answer length against
  a target word count.
- **Clarity**: a sentence-length heuristic (words per sentence),
  independent of whether the content is correct.
- All four scores (`technicalScore`, `relevanceScore`, `clarityScore`,
  `completenessScore`) are integers bounded `0–100` (enforced by the
  Pydantic response model). The same input always produces the same
  output — no randomness anywhere in the pipeline.
- `strengths`/`weaknesses` are generated from which specific signal was
  strong or weak (e.g. naming the actual missing concepts), and
  `suggestedImprovement` targets whichever of the four scores is
  currently weakest — not generic, answer-independent text.
- `modelAnswer` comes from the matched reference entry, or an honest
  "no reference model answer is available for this question yet" if the
  question isn't in the local bank.

### Request/response contract

Node sends (snake_case, matching the Python Pydantic schema):
```json
{ "question": "...", "answer": "...", "target_role": "...", "difficulty": "medium", "interview_type": "technical" }
```
Python returns (camelCase, matching `interview_answers`' columns 1:1 after the obvious snake_case conversion):
```json
{
  "technicalScore": 85, "relevanceScore": 78, "clarityScore": 90, "completenessScore": 82,
  "strengths": ["..."], "weaknesses": ["..."],
  "suggestedImprovement": "...", "modelAnswer": "..."
}
```
`aiServiceClient.js` validates every field's presence, type, and (for
the four scores) range before trusting the response — a malformed
response is treated as a service failure, not partially applied.

### Failure handling — no fake scores, ever

If the AI service is unreachable, times out (10s), returns a non-2xx
status, or returns an invalid shape, `aiServiceClient.evaluateAnswer`
throws a `503` with the message `"AI evaluation service is temporarily
unavailable."` This propagates straight to the HTTP response — **no
answer row is created** in that case, so there is never a fabricated
score sitting in the database pretending to be a real evaluation. The
frontend surfaces this as a normal error state (see `LiveInterview.jsx`).

### Service-to-service authentication

Node sends `X-AI-Service-Key: <AI_SERVICE_API_KEY>` on every `/evaluate`
call; Python rejects the request with `401` if it's missing or wrong.
This is a shared secret between the two backend services, not a user-auth
system — the end user's JWT was already verified by Node's own
`requireAuth` before this call is ever made. `AI_SERVICE_API_KEY` must
match exactly between `backend/.env` and `ai-service/.env`, is never sent
to the frontend, and is never logged.



## Coding Module (Phase 8)

Problem browsing, problem detail, and submission **persistence** are
real. **Phase 8 does not execute submitted code. Code execution will be
implemented in the Docker-based execution phase (Phase 9).**

### Flow

```text
GET /api/coding/problems           → list, with optional ?topic, ?difficulty, ?search
GET /api/coding/problems/:id       → detail + generic starter code per language (404 if not found)
POST /api/coding/submissions       → INSERT coding_submissions, status="pending" — NOT executed
GET /api/coding/submissions        → the caller's own submissions
GET /api/coding/submissions/:id    → one submission, ownership-checked (404 on mismatch)
```

`services/codingService.js` orchestrates this (same controller → service
→ model layering as the interview module); `services/codingStarterTemplates.js`
supplies generic per-language starter code (`cpp`/`java`/`python`/`javascript`)
since `coding_problems` has no per-problem starter-code column and adding
one wasn't necessary for this phase.

### Hidden test cases never reach the browser

`coding_problems.test_cases` (which can hold `is_hidden` entries) is
**deliberately excluded** from both `getAllProblems` and `getProblemById`
in `models/codingModel.js` — only `examples` (the public input/output
samples) are ever selected for these endpoints. The future Docker
execution service (Phase 9) is the only thing that will read
`test_cases`, directly from PostgreSQL, server-side.

### Submission validation & ownership

`createSubmissionRules` (in `middleware/validators.js`) allowlists
`language` to exactly `cpp`/`java`/`python`/`javascript` — never an
arbitrary string — requires non-empty `sourceCode` (max 20,000 chars),
and validates `problemId`/optional `sessionId` as positive integers.
`POST /api/coding/submissions` always uses `req.user.userId`; a
`userId` in the request body would simply be ignored even if sent. The
request body has no `testCases` field at all — the frontend has no way
to supply or override them (see the Phase 9 section below).
`GET /api/coding/submissions/:id` checks the submission's `user_id`
against the caller and returns `404` (not `403`) on a mismatch.

## Secure Docker Code Execution (Phase 9)

`POST /api/coding/submissions` now actually **executes** the submitted
code — inside an isolated, ephemeral Docker container, via a new
top-level service (`code-executor/`, a sibling of `backend/`) — instead
of just persisting it with `status: "pending"`. **Node remains the only
service with PostgreSQL credentials; the executor never connects to the
database, directly or indirectly**, and never talks to React directly —
every request to it comes from `backend/services/codeExecutorClient.js`.

> "Code execution occurs only inside isolated Docker containers. The
> Node backend never executes submitted source code directly."

See `code-executor/README.md` for the executor's own full architecture,
security checklist, and known limitations. This section covers the Node
side of the integration and how results map onto the existing schema.

### Flow

```text
POST /api/coding/submissions
  → codingService.createSubmission()
  → INSERT coding_submissions, status="pending"  (commits immediately — see "Transaction design" below)
  → codingModel.getProblemTestCases(problemId)     — reads test_cases from PostgreSQL; NEVER from the request body
  → codeExecutorClient.executeCode({ language, sourceCode, testCases })
  → HTTP POST http://<CODE_EXECUTOR_URL>/execute  (header: X-Code-Executor-Key)
  → Python: ephemeral Docker container compiles (if needed) + runs each test case
  → validated JSON response: { status, passedTests, totalTests, executionTimeMs, memoryUsedKb, tests, stderr }
  → codingModel.updateSubmissionResult() — maps to the DB's 4 allowed statuses (see below)
  → sanitized result returned to React (never includes hidden test inputs/expected outputs)
```

### Hidden test cases — the full chain, not just one layer

1. `coding_problems.test_cases` is **never** selected by `getAllProblems`/`getProblemById` (Phase 8) — the problem-browsing endpoints structurally cannot return it.
2. The only reader of that column is `codingModel.getProblemTestCases()`, called exclusively from `codingService.createSubmission()`, server-side.
3. The executor's own response shape (`tests: [{ index, passed }]`) has no field for expected output or test input at all — even if Node forwarded it unchanged, there'd be nothing to leak.
4. `codeExecutorClient.js` additionally validates the response shape before trusting it, so a compromised or buggy executor response can't smuggle extra fields through to the client either.
5. `POST /api/coding/submissions`'s request validation (`createSubmissionRules`) has no `testCases` field — the frontend has no way to send one, so there's nothing to "trust or not trust" from the client in the first place.

### Status mapping — executor status → database status

`database/schema.sql`'s `coding_submissions.status` CHECK constraint only
allows `pending` / `passed` / `failed` / `error` — the executor's richer
vocabulary (`completed`, `compilation_error`, `runtime_error`, `timeout`,
`memory_limit`, `output_limit`, `execution_error`) is mapped down in
`codingService.js`'s `toDbStatus()`:

```text
completed, passedTests === totalTests (and totalTests > 0)  → "passed"
completed, otherwise                                         → "failed"
anything else (compilation_error/runtime_error/timeout/
  memory_limit/output_limit/execution_error)                 → "error"
```

The richer status (`executionStatus`) and the per-test results
(`tests`) and safe compiler/runtime text (`stderr`) are **not persisted**
— there are no columns for them beyond the coarse `status` — but they
ARE included in the immediate API response right after submission, so
the frontend can show something more specific than "error" once, even
though a later `GET` of the same submission only shows the coarser
persisted status. This is a deliberate, documented trade-off rather than
an oversight.

### Transaction design

Per the Phase 9 spec: the submission row is created with `status:
"pending"` and that `INSERT` commits immediately — no PostgreSQL
transaction is held open while waiting on Docker, since execution can
take seconds and holding a transaction open that long would be an
unnecessary lock/connection-pool cost for no benefit (nothing else needs
those two writes to be atomic with each other). The row is then updated
with the final result in a second, separate `UPDATE` once execution
completes.

### Failure consistency — executor-unavailable ≠ code failed

If `codeExecutorClient.executeCode()` throws (network failure, timeout,
non-2xx response, or a response that fails shape validation), that
propagates as a `503` and **the submission row is left as `"pending"`**
— not updated to `"error"`. These are different conditions: `"error"`
means the code ran and something went wrong; a `503` with the row still
`"pending"` means we don't actually know what would have happened. There
is no retry endpoint in this phase — resubmitting creates a new
submission row.

### Service-to-service authentication

Node sends `X-Code-Executor-Key: <CODE_EXECUTOR_API_KEY>` on every
`/execute` call; the executor rejects the request with `401` if it's
missing or wrong. Same pattern as `AI_SERVICE_API_KEY` in Phase 7 — a
shared secret between the two backend services, never sent to or
readable by the frontend, and must match exactly between
`backend/.env` and `code-executor/.env`.

### No code execution on this host, ever

Nothing in `backend/` uses `eval`, `Function`, `child_process`, or
spawns any process to run submitted code — `codeExecutorClient.js` only
makes an HTTP call. All actual execution happens inside Docker,
orchestrated by the Python executor service using the `docker` SDK's
controlled API (`exec_create`/`exec_start`/`exec_inspect`), never a raw
shell command built from submitted source.

## Speech Processing (Phase 10)

Voice answers are now a second, complete answer-submission path,
alongside the Phase 6/7 text path — not a replacement for it. Both paths
end up producing the same shape of stored row in `interview_answers`.

### Flow

```text
Browser: MediaRecorder captures the mic → audio Blob
  → React: FormData { audio: <blob>, questionId: <id> }
  → POST /api/interviews/:id/answer/audio  (multipart/form-data, JWT via the existing interceptor)
  → multer (middleware/audioUpload.js): validates MIME type + size, buffers in memory — never written to disk on the Node host
  → interviewController.submitAudioAnswer → interviewService.submitAudioAnswer
      (same ownership/duplicate-answer checks as the text path — see _assertCanAnswer)
  → aiServiceClient.evaluateSpeechAnswer(): multipart POST to Python, X-AI-Service-Key header
  → Python POST /speech-evaluate: faster-whisper transcription (local/offline) →
      the SAME evaluator.py used for text answers, applied to the transcript → speech metrics
  → validated response → interviewModel.createAnswer() stores audio_transcript + speech_metrics
      alongside the same technical/relevance/clarity/completeness/strengths/weaknesses/etc. columns
      the text path uses (cv_metrics is never touched — that's a future phase)
  → next-question / sessionComplete logic — identical to the text path
```

### Two independent paths, one shared evaluator

```text
Text:  POST /api/interviews/:id/answer        → aiServiceClient.evaluateAnswer()       → Python POST /evaluate
Voice: POST /api/interviews/:id/answer/audio  → aiServiceClient.evaluateSpeechAnswer()  → Python POST /speech-evaluate
```
These are genuinely separate routes/controller functions/service
functions — submitting text never touches the audio upload middleware,
and submitting audio never touches `answerText` validation. Both
ultimately call the same content evaluator on the Python side (typed
text for one, a transcript for the other) — not two different scoring
systems.

### Request/response contract

Frontend → Node (multipart, field names must match exactly across the whole chain):
```text
audio        (file)    — the recorded Blob
questionId   (text)    — validated as a positive integer, same as the text path
```
Node → Python (multipart): `audio` (file), plus `question`/`target_role`/`difficulty`/`interview_type` as form fields — see `ai-service/README.md` for the full contract.

Python → Node → React (the fields actually used from the response):
```json
{
  "transcript": "...",
  "technicalScore": 85, "relevanceScore": 78, "clarityScore": 90, "completenessScore": 82,
  "strengths": ["..."], "weaknesses": ["..."],
  "suggestedImprovement": "...", "modelAnswer": "...",
  "speechMetrics": {
    "durationSeconds": 6.2, "wordCount": 8, "speakingRateWpm": 77.4,
    "fillerWordCount": 0, "fillerWords": {},
    "pauseCount": null, "averagePauseSeconds": null
  }
}
```
`aiServiceClient.js`'s `isValidSpeechEvaluation()` validates every field's
type before trusting it — including allowing `pauseCount`/
`averagePauseSeconds` to legitimately be `null` (not requiring them to be
numbers), since pause detection isn't always available. A response
missing a required field, or with a wrong type, is treated exactly like
a service failure — no partially-valid evaluation is ever stored.

### Audio upload validation (`middleware/audioUpload.js`)

- **Size limit**: `MAX_AUDIO_BYTES` (10 MB default), enforced by multer — a violation surfaces as a real error (`err.code === 'LIMIT_FILE_SIZE'`), mapped to `413` by `errorHandler.js`.
- **MIME allowlist**: `audio/webm`, `video/webm` (some browsers label a webm/opus audio-only blob this way), `audio/wav`, `audio/mpeg`, `audio/mp4`/`audio/m4a`, `audio/ogg` — matched with any `;codecs=...` suffix stripped. A rejected type doesn't error (multer's `fileFilter` callback convention) — it's flagged via `req.fileValidationError` and turned into a clean `415` by `requireAudioFile`.
- **Storage**: `multer.memoryStorage()` — the buffer lives only in `req.file.buffer` for the request's duration, forwarded straight to Python, never written to disk on the Node host. There is nothing to clean up on the Node side; Python manages its own temp file for the copy it needs to hand to faster-whisper (see `ai-service/README.md`).
- **Never trusted from the client**: `userId` (always `req.user.userId`), any score, the transcript, or `speech_metrics` — all of that comes back from Python only.

### Failure handling

If Python's speech pipeline is unavailable, times out, or returns an invalid response, `aiServiceClient.evaluateSpeechAnswer` throws a `503` — **no answer row is created**, exactly like the text path's equivalent failure mode. The frontend shows: *"Speech processing is currently unavailable. Please try again or switch to text mode."*

### Frontend recording (`LiveInterview.jsx`)

Checks `typeof MediaRecorder !== 'undefined'` before offering voice mode
at all; if unsupported, shows a plain message and text mode remains
fully usable (voice/text is chosen per-interview at setup, not toggled
mid-question). Picks the first browser-supported MIME type from
`audio/webm;codecs=opus` → `audio/webm` → `audio/mp4` via
`MediaRecorder.isTypeSupported()`, falling back to the browser's own
default if none of those are supported — never hardcoded to a single
format. The "Start Recording" button is disabled while a submission of
either kind is in flight, so a user can't fire off two answers to the
same question. Microphone permission denial is caught and shown as a
plain message rather than crashing the page.

## Folder structure

```text
backend/
├── config/db.js              PostgreSQL pool + checkConnection() for /api/health/db
├── controllers/               Route handlers — real DB logic where noted below
├── routes/                    Route → controller wiring + validation, matches Phase 1 API contracts
├── middleware/
│   ├── auth.js                 requireAuth — real JWT verification, sets req.user
│   ├── validate.js              handleValidationErrors — turns express-validator failures into 400s
│   ├── validators.js             Reusable validation chains (idParam, registerRules, loginRules, etc.)
│   ├── audioUpload.js             multer config for POST /interviews/:id/answer/audio (Phase 10)
│   ├── notFound.js               404 handler
│   └── errorHandler.js           Centralized errors, incl. PostgreSQL + multer error-code translation
├── services/
│   ├── aiServiceClient.js         HTTP client → Python /evaluate + /speech-evaluate (Phase 7 + 10, real). generateQuestions/analyzeCode still stubs.
│   ├── codeExecutorClient.js       HTTP client → code-executor /execute (Phase 9, real)
│   ├── authService.js              register/login: bcrypt hashing + JWT issuance
│   ├── profileService.js           Transactional profile+skills upsert
│   ├── interviewQuestionService.js  Deterministic local question bank (NOT AI — see Phase 6 section)
│   ├── interviewService.js          Orchestrates session/question/answer(+audio)/completion + transactions
│   ├── codingService.js              Problem retrieval + submission execution (Phase 9 — see that section)
│   └── codingStarterTemplates.js     Generic per-language stdin/stdout starter programs
├── models/                     One query module per table/resource — all parameterized SQL
├── utils/
│   ├── apiResponse.js            Shared { success, data } / { success, message } helpers
│   └── jwt.js                     generateToken / verifyToken
├── app.js                      Express app, middleware, route registration, health checks
└── server.js                    Loads .env, starts the HTTP server
```

## What's real vs. placeholder as of Phase 10

**Real:**
- `POST /api/auth/register`, `POST /api/auth/login` — bcrypt hashing, JWT issuance
- `POST /api/auth/logout` — trivial (JWT is stateless; protected but does no real work)
- `GET /api/health/db`
- `GET /api/skills`, `GET /api/topics` (public — not user-specific)
- `GET /api/coding/problems` (with `topic`/`difficulty`/`search` filters), `GET /api/coding/problems/:id` (public; hidden test cases never included)
- `GET /api/users/profile`, `PUT /api/users/profile` — requires JWT, scoped to `req.user.userId`
- **All 6 interview endpoints** (including `POST /api/interviews/:id/answer/audio`) — requires JWT, ownership-checked, backed by real PostgreSQL reads/writes. Question *selection* is a deterministic local bank (Phase 6, not AI). Text-answer *scoring* is the Phase 7 Python NLP evaluation service; voice-answer transcription + scoring is the Phase 10 speech pipeline (faster-whisper + the same Phase 7 evaluator applied to the transcript) — neither is an LLM.
- **`POST /api/coding/submissions`, `GET /api/coding/submissions`, `GET /api/coding/submissions/:id`** — requires JWT, ownership-checked. `POST` now actually **executes** the code inside an isolated Docker container (Phase 9) and stores the real result — see "Secure Docker Code Execution" above.

**Still placeholder (HTTP 501, naming the phase that implements it):**
- `POST /api/coding/run`, `POST /api/coding/submit` — reserved for a future lighter-weight "run without submitting" flow; distinct from `POST /api/coding/submissions` above, which is the one that executes code
- `GET /api/dashboard`, `GET /api/performance` — Phase 12


## Phase J — hiring teams, privacy and trust
See `PHASE_J_README.md` (repo root). New route groups: `/api/hirer/team`, `/api/hirer/audit-log`, `/api/notifications`, `/api/account`,
plus `POST /api/hirer/applications/:id/scorecard`, `POST /api/applications/:id/consent`, `GET /api/applications/:id/access-log`.
Migrations 010-013 are required at startup (`utils/migrationCheck.js`).

## Voice, camera and delivery feedback (Phase M)

- **Error contract.** AI-service failures are forwarded as `{ success:false, message, reason, retryable }` (additive
  fields). Reasons: `speech_package_missing`, `speech_model_loading`, `speech_model_unavailable`,
  `speech_transcription_failed`, `no_speech_detected`, `audio_too_short`, `audio_too_long`, `audio_unreadable`,
  `unsupported_media`, `upload_too_large`, `ai_service_timeout`, `ai_service_unreachable`, `ai_service_not_configured`,
  `ai_service_auth` (the two `AI_SERVICE_API_KEY` values differ), `ai_invalid_response`. Raw AI-service bodies are never forwarded.
- **`AI_SERVICE_SPEECH_TIMEOUT_MS`** (default 120000, max 600000) bounds speech and video requests.
- **`GET /api/interviews/capabilities`** (candidate only) returns the AI service's speech/vision state so the UI can warn before recording.
- **Typing metrics** (`POST /api/interviews/:id/answer` accepts an optional `typingMetrics` counter object). The server
  re-derives every figure in `utils/typingMetrics.js` and stores it in `interview_answers.typing_metrics` (migration 013) for
  **practice sessions only**.
- **Delivery (behaviour) score** (`utils/behaviorScoring.js`) is computed on read for practice sessions and returned as
  `answer.behavior_summary` and `delivery` on `GET /api/interviews/:id`. It uses only counts, timings and ratios; it is
  advisory, not part of `final_score`, its thresholds are unvalidated rules of thumb, and it is never selected by any hirer query.
