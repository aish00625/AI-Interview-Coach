# Phase O - free local AI (Ollama)

Adds optional AI features that run on your own computer through [Ollama](https://ollama.com). No paid API, no cloud calls. If Ollama is stopped, every feature falls back to the existing rule-based logic or hides itself, and the rest of the app works as before.

## What was added
| Feature | Where | Without the model |
|---|---|---|
| Follow-up questions (multi-turn, up to `FOLLOWUP_MAX_TURNS` per question, skippable) | Live interview, practice only | Uses the authored follow-up of the question if there is one, otherwise the button explains why none is available |
| STAR coaching with quoted evidence | Results page, behavioural / HR / mixed interviews | Rule-based STAR check (labelled "Rule-based") |
| Written interview report | Results page | Report built from your scores by fixed rules |
| Coding coach (explain failures, hints, edge cases, complexity estimate) | Coding workspace | Built-in test explanation only |
| Daily practice plan | Dashboard | Always rule-based; uses only your real records |

Every result is labelled **Local AI** or **Rule-based**.

## Safety rules enforced in code
- The Docker code executor stays the only authority on pass/fail. The coach re-runs the **visible sample tests**, returns the executor result unchanged and puts the AI notes beside it. Nothing is submitted. Hidden tests and reference solutions never reach the model. The coach is refused (403) for a problem that is part of an assessment you are currently taking.
- Follow-ups are stored in a separate table (`interview_followups`) and never change answers, scores, final score or analytics. They are not available in hiring assessments (403) and are never shown to hirers.
- The model never receives model answers, other users' data or hidden tests. Candidate text is passed as quoted data; replies are validated (length limits, STAR evidence must be a verbatim quote, no code in coaching text, follow-up must be a new question).
- All routes need a login; ownership is checked on every read and write. AI-service endpoints still need the shared `AI_SERVICE_API_KEY`. Ollama is only contacted on this computer unless `LLM_ALLOW_REMOTE=true`.
- Rate limit per user (`LLM_MAX_PER_MINUTE`) and one model request at a time.
- AI output is advisory. Nothing is decided automatically.

## Setup (nothing is installed or downloaded for you)
1. Install Ollama from ollama.com and start it.
2. `ollama list` shows what you already have. If `qwen3:4b` is missing: `ollama pull qwen3:4b` (about 2.5 GB download).
3. Low memory (8 GB RAM or less, no GPU)? Use a smaller model and set `LLM_MODEL` in `ai-service/.env`: `qwen3:1.7b` or `llama3.2:3b`.
4. Run `scripts\windows\upgrade-existing-install.ps1` (or `setup.ps1`) to apply migration `015_local_ai` (additive; creates `interview_followups` and `ai_feedback`). Restart the backend and AI service.
5. The dashboard shows a status badge ("Local AI ready", "Local AI is off", "AI model not installed").

The first answer after Ollama starts can take a minute while the model loads. Timeouts: `LLM_TIMEOUT_SECONDS` (AI service), `AI_SERVICE_LLM_TIMEOUT_MS` (backend).

## Check it against the real model
`powershell -ExecutionPolicy Bypass -File scripts\windows\check-local-ai.ps1` asks Ollama for its models, then runs the app's own follow-up, STAR, coding-coach and report prompts with full validation and prints exactly what a user would see. It changes nothing. No `.env` edit is needed for the defaults (`qwen3:4b` at `http://127.0.0.1:11434`).

How the prompts are kept short and structured: every task sends a JSON schema to Ollama, turns off hidden reasoning (`think: false`, plus `/no_think` for qwen3-style models), and tells the model to answer in plain second-person sentences. Replies are validated; a cut-off or invalid reply is retried once, then the rule-based fallback is used.

## Environment variables
AI service (`ai-service/.env`): `LLM_ENABLED`, `OLLAMA_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_SECONDS`, `LLM_STATUS_TIMEOUT_SECONDS`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_TEMPERATURE`, `LLM_CONTEXT_TOKENS`, `LLM_ALLOW_REMOTE`, `LLM_MAX_CONCURRENT`, `LLM_QUEUE_WAIT_SECONDS`.
Backend (`backend/.env`): `AI_SERVICE_LLM_TIMEOUT_MS`, `FOLLOWUP_MAX_TURNS`, `LLM_MAX_PER_MINUTE`.

## New API routes (all authenticated)
`POST /interviews/:id/follow-ups`, `POST /interviews/:id/follow-ups/:followUpId/answer`, `POST .../skip`, `GET|POST /interviews/:id/questions/:questionId/star`, `GET|POST /interviews/:id/ai-report`, `POST /coding/coach`, `GET /dashboard/plan`, `GET /dashboard/ai-status`. AI service: `/llm/status`, `/llm/follow-up`, `/llm/follow-up-feedback`, `/llm/star`, `/llm/code-coach`, `/llm/report`.

## What was verified (authoring sandbox)
Tests run: AI-service unit tests against a fake Ollama server (availability, malformed JSON, timeouts, validation); backend tests on real PostgreSQL with a controllable fake model (access control, privacy between users, scores unchanged, fallback, hiring-assessment refusal, coach never exposing hidden tests); client tests for status/timeout/malformed mapping; source-level frontend wiring tests.
**Not verified:** answer quality of a real model (never run), rendering in a browser, `npm run build`, Docker, Windows. Small models can be wrong, which is why everything is labelled advisory.
