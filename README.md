# AI Interview Coach + Coding Round Analyzer

A full-stack interview practice and hiring-assessment platform:

- **Candidates** practise AI-scored interviews (typed or spoken answers), solve coding problems that run in an isolated
  Docker sandbox, track their progress, apply to jobs and take hirer assessments.
- **Hirers** post jobs, review applicants, build assessments (aptitude MCQs, technical MCQs and coding problems), invite
  applicants, and review results with optional, consent-based camera monitoring.
- **Admins** approve hiring organizations and see platform health.

## Features

| Area | What it does |
|---|---|
| AI interviews | Question bank by type/difficulty; text and voice answers (local Whisper speech-to-text); content scoring, delivery feedback, follow-ups and STAR coaching from a local LLM (Ollama) with rule-based fallbacks |
| Coding practice | 46 problems with visible and hidden tests; Python, JavaScript, Java and C++ executed in locked-down Docker containers (no network, read-only root, dropped capabilities, CPU/memory/PID limits); Run Code, Submit, tiered hints, coding coach |
| Jobs and applications | Job board, resume upload, applications with explicit consent, blind review, scorecards, notes, audit log, notifications |
| Hirer assessments | Organization question bank (single- and multiple-answer MCQs), assessment builder with up to three sections (aptitude, technical, coding), timing, attempts, negative marking, randomisation, draft/publish/close and versioning, reviewer assignment, invitations |
| Candidate assessment flow | Instructions and consent, optional camera with a no-camera alternative, server-timed sections with autosave and resume, coding through the sandbox, review and submit |
| Camera monitoring | Face presence, multiple faces, image quality, head pose and gaze (when the face-landmark model is available). Stores timestamped observations only, never video or images. Never part of any score and never rejects anyone automatically |
| Results | Server-side scoring per section, per-question review for hirers, coding runs, camera-analysis summary and limitations, reviewer notes |

## Architecture

```
React + Vite (5173) --JWT--> Node.js / Express API (5000) --> PostgreSQL (5432)   (only the API talks to the database)
                                   |-- X-AI-Service-Key -------> AI service, Python / FastAPI (8000) --> Ollama (11434, optional)
                                   '-- X-Code-Executor-Key ----> Code executor, Python / FastAPI (9000) --> Docker (one sandbox per run)
```

| Folder | Technology |
|---|---|
| `frontend/` | React 18, React Router 7, Vite, Monaco editor, Recharts |
| `backend/` | Node.js (CommonJS), Express, `pg`, JWT, express-validator, multer |
| `ai-service/` | Python 3.12, FastAPI, scikit-learn, faster-whisper (speech), OpenCV + MediaPipe (camera) |
| `code-executor/` | Python 3.12, FastAPI, Docker SDK |
| `database/` | `schema.sql` (base tables) and ordered, additive `migrations/001-018` (each with a `.down.sql`) |
| `scripts/windows/` | `setup.ps1` (one-time setup) and `start-all.ps1` (starts the services) |

More detail: `WINDOWS_SETUP_GUIDE.md`, `backend/README.md`, `ai-service/README.md`, `code-executor/README.md`, `docs/`.

## Prerequisites (Windows)

| Tool | Version | Notes |
|---|---|---|
| Git | any recent | |
| Node.js | 20 or newer | includes npm |
| Python | 3.12 (3.11 also works) | tick **Add python.exe to PATH** during install |
| PostgreSQL | 16 or newer | remember the `postgres` password; add `C:\Program Files\PostgreSQL\<version>\bin` to PATH so `psql` works |
| Docker Desktop | current | needed for coding rounds; must be running |
| Ollama (optional) | current | for AI follow-ups and coaching: `ollama pull qwen3:4b`. Without it those features fall back to rule-based text |

Use Chrome or Edge on `http://localhost` (camera and microphone need localhost or https).

## Setup (first time)

Open **PowerShell** in the folder where you want the project.

### 1. Clone

```powershell
git clone https://github.com/aish00625/AI-Interview-Coach.git
cd AI-Interview-Coach
```

### 2. Create the database and load the base schema

```powershell
psql -U postgres -c "CREATE DATABASE ai_interview_coach;"
psql -U postgres -d ai_interview_coach -f database/schema.sql
```

### 3. Run the setup script

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1
```

It asks for your PostgreSQL password once, then:
- creates `backend/.env`, `ai-service/.env` and `code-executor/.env` from their `.env.example` files with freshly generated
  secrets (it never overwrites an existing `.env`);
- installs npm packages and creates the Python virtual environments;
- applies every migration in `database/migrations` in order (additive and re-runnable; never drops anything);
- seeds the 46 coding problems (`npm run seed:problems`);
- downloads the speech model once (about 460 MB) and checks speech recognition.

Optional flags: `-WithVision` (webcam analysis packages), `-SkipSpeech`, `-SkipDiagnostics`.

### 4. Start the Docker code executor

The executor runs in Docker so it can create sandbox containers. It reads its key from the **root** `.env`:

```powershell
copy .env.example .env
```

Edit the root `.env`:
- `CODE_EXECUTOR_API_KEY` must be **exactly** the same value as `CODE_EXECUTOR_API_KEY` in `backend/.env`;
- `POSTGRES_PASSWORD`, `JWT_SECRET` and `AI_SERVICE_API_KEY` must not be empty (Docker Compose checks them even though only
  the executor is started here); any value works for this step.

Then, with Docker Desktop running:

```powershell
docker compose --profile executor up -d --build code-executor
curl http://localhost:9000/health
```

The first start pulls the four language images in the background (about 2 GB). Until they arrive, submissions show
"The code runtime is still being prepared". To pull them right away:
`docker compose --profile executor exec code-executor python -m app.prepare_images`

### 5. Start the other services

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\start-all.ps1
```

This opens one window each for the AI service, the backend and the frontend. (Do **not** add `-WithExecutor` when the
Docker executor from step 4 is running: both use port 9000.) Close a window to stop that service.

### 6. Create accounts for the demo

1. Open `http://localhost:5173` and **register a hirer** (role Hirer, with a company name). The organization starts as pending.
2. Create an admin:
   ```powershell
   cd backend
   node scripts/create-admin.js
   ```
3. Log in as the admin, open **Organizations**, and approve the company. (Or:
   `psql -U postgres -d ai_interview_coach -v org="Your Company" -f database/seed/approve_organization.sql`)
4. Load the 30 sample assessment questions into that company's question bank (dry run first, then apply):
   ```powershell
   cd backend
   npm run seed:questions -- --org="Your Company"
   npm run seed:questions -- --org="Your Company" --apply
   ```
5. Register a **candidate** account in another browser (or a private window).

## Environment variables

Every service has a `.env.example` with placeholders. Real `.env` files are created locally and are never committed.

| File | Key variables |
|---|---|
| `backend/.env` | `DATABASE_URL`, `JWT_SECRET`, `AI_SERVICE_URL`, `AI_SERVICE_API_KEY`, `CODE_EXECUTOR_URL`, `CODE_EXECUTOR_API_KEY`, `FRONTEND_URL`, `PORT` |
| `ai-service/.env` | `AI_SERVICE_API_KEY` (same as backend), speech settings, `OLLAMA_BASE_URL`, `LLM_MODEL` |
| `code-executor/.env` | `CODE_EXECUTOR_API_KEY` (same as backend); used when the executor runs natively instead of in Docker |
| `frontend/.env` | `VITE_API_BASE_URL` (default `http://localhost:5000/api`) |
| root `.env` | used by `docker-compose.yml`: `CODE_EXECUTOR_API_KEY` (same as backend) and the other required keys |

The shared keys must match between services, or the backend gets `401` from the AI service or the executor.

## Local URLs and ports

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| Backend API | http://localhost:5000/api (health: `/api/health`, database: `/api/health/db`) |
| AI service | http://localhost:8000/health |
| Code executor | http://localhost:9000/health |
| PostgreSQL | localhost:5432 |
| Ollama (optional) | http://localhost:11434 |

## Demo workflow (about 10 minutes)

1. **Candidate:** Dashboard -> **New Interview** -> answer one question by voice and one by typing -> results and feedback.
2. **Candidate:** **Coding Problems** -> open a problem -> **Run Code** (sample tests) -> **Submit** (hidden tests show only pass/fail).
3. **Hirer:** **Job Openings** -> create and publish a job. **Candidate:** apply to it (agree to share the resume and assessment results).
4. **Hirer:** **Assessments** -> **New assessment** for that job -> add aptitude and technical questions from the bank and one coding
   problem -> save -> **Preview as candidate** -> **Publish** -> **Candidates & results** -> invite the applicant.
5. **Candidate:** **My Assessments** -> open it -> choose camera monitoring (or the alternative) -> complete the sections ->
   **Review & submit**.
6. **Hirer:** open the result: per-section scores, per-question answers, code runs, **Monitoring events** (camera summary,
   head pose and gaze, image quality, limitations) and reviewer notes. The hiring decision stays on the application page.

## Running the tests

```powershell
cd frontend;       npm test;  npm run build
cd ..\backend;     npm test;  npm run verify:problems
cd ..\ai-service;    .\venv\Scripts\python.exe -m unittest discover -s tests
cd ..\code-executor; .\venv\Scripts\python.exe -m unittest discover -s tests
```

Backend tests that need a real database (`*_realdb`) are skipped unless `AIC_TEST_DB` names a **separate test database**;
never point them at your working database.

## Troubleshooting

| Problem | Fix |
|---|---|
| `psql` is not recognized | Add `C:\Program Files\PostgreSQL\<version>\bin` to PATH and open a new PowerShell window |
| Migration fails with `relation "users" does not exist` | Load `database/schema.sql` first (setup step 2), then re-run `setup.ps1` |
| Backend exits saying migrations are missing | Re-run `setup.ps1` (or apply the missing files in `database/migrations` in order) |
| `password authentication failed` | Fix the password in `DATABASE_URL` in `backend/.env` |
| Interview answers fail with an AI-service `401` | `AI_SERVICE_API_KEY` differs between `backend/.env` and `ai-service/.env` |
| Code runs return 503 / "executor unavailable" | Start Docker Desktop, then `docker compose --profile executor up -d code-executor`; check `http://localhost:9000/health`; the key in the root `.env` must match `backend/.env` |
| "The code runtime is still being prepared" | The language images are still downloading; wait or run the `prepare_images` command above |
| `EADDRINUSE` / port already in use | Another copy is running: close the old window or stop the process using that port |
| Voice answers fail the first time | The speech model is still loading (watch the AI service window); try again in a minute |
| Camera shows a permission error | Allow the camera for `localhost` (camera icon in the address bar); candidates can choose the no-camera alternative |
| AI follow-ups say "unavailable" | Ollama is not running or the model is missing: `ollama pull qwen3:4b` (rule-based feedback still works) |

## Data and privacy notes

- No database dump is included. Each teammate creates an empty database and loads the schema, migrations and seed data.
- `backend/data/coding-problems/*/tests.json` contains the coding problems' hidden tests (needed for seeding): keep this
  repository private if it is used for real assessments.
- Never commit `.env` files, database backups or the `backend/uploads/` folder (uploaded resumes); `.gitignore` excludes them.
