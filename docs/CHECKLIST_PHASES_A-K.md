# AI Interview Coach — Windows guide and the single end-to-end test (Phases A–K, final pre-test version)

Project root assumed: `C:\Users\Aishu\Downloads\major`. Everything is PowerShell. **Nothing here drops or resets your database.**
This replaces the older A–F guide for the final run. Do it once, at the end, when your laptop is plugged in (it runs five services).

> **Honest status before you start.** Nothing below has been run on Windows. In the Linux sandbox the following were run:
> real-PostgreSQL integration tests (221 Node tests), 29 AI-service and 11 executor unit tests, 23 validation-tool tests, a JSX syntax check,
> and local verification of the 14 coding problems. **Never run in the sandbox:** the real Express server, express-validator rules, multer, bcrypt/JWT,
> pdf-parse, the React build, any browser, the FastAPI HTTP layer, and **Docker code execution**. This test is the first time those run.
> **Docker execution is not verified until Part 8 step 8 passes on your machine.** The complete application is not claimed to work until this checklist passes.

---
## Part 0 — Which patch to apply
**Apply exactly one patch: `Complete-A-K-patch.zip`.** It contains the final state of every file changed in Phases A–K (listed in its `CHANGED_FILES.txt`; checksum in `SHA256SUMS.txt`).
It is safe whether or not you applied earlier phase patches, because it carries final file contents, never deltas. It never deletes files and never touches your `.env` files, your database or your resume folder.
Do **not** also apply `Cumulative-patch.zip`, `Cumulative-G-K-patch.zip` or the per-phase zips; they are kept only as unchanged history (the earlier `Cumulative-G-K-patch.zip` lacks the final pre-test fixes).
It assumes your folder contains the original project you started with (React/Node/FastAPI base); files the patch does not list are left as they are.
Phase K adds only the `validation\` study kit (no runtime change; the study is PENDING — see `validation\STUDY_STATUS.md`).

## Part 1 — Back up (do not skip)
```powershell
$proj  = "C:\Users\Aishu\Downloads\major"
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
New-Item -ItemType Directory -Force "$proj\_backups" | Out-Null
foreach ($d in "backend","frontend","ai-service","code-executor","database") {
  if (Test-Path "$proj\$d") { robocopy "$proj\$d" "$proj\_backups\$d-$stamp" /E /XD node_modules venv __pycache__ | Out-Null }
}
pg_dump -U postgres -d ai_interview_coach -F c -f "$proj\_backups\db-$stamp.dump"
(Get-Item "$proj\_backups\db-$stamp.dump").Length     # must be > 0
```
Also copy your resume folder (`RESUME_STORAGE_DIR`, default `backend\uploads\resumes`). `robocopy` exit codes 0–7 mean success.

## Part 2 — Verify and apply the patch
```powershell
Get-FileHash "$env:USERPROFILE\Downloads\Complete-A-K-patch.zip" -Algorithm SHA256   # compare with SHA256SUMS.txt
Expand-Archive "$env:USERPROFILE\Downloads\Complete-A-K-patch.zip" "$env:USERPROFILE\Downloads\Complete-A-K-patch-x" -Force
$patch = "$env:USERPROFILE\Downloads\Complete-A-K-patch-x\Complete-A-K-patch"      # folder that contains backend, frontend, database ...
foreach ($d in "backend","frontend","database","ai-service","code-executor","docker","validation",".github") {
  if (Test-Path "$patch\$d") { New-Item -ItemType Directory -Force "$proj\$d" | Out-Null; Copy-Item "$patch\$d\*" "$proj\$d" -Recurse -Force }
}
foreach ($f in "docker-compose.yml",".env.example",".dockerignore") { if (Test-Path "$patch\$f") { Copy-Item "$patch\$f" "$proj\$f" -Force } }
```
If your backend/frontend live one level deeper (e.g. `major\backend\backend`), copy into the folder that holds `package.json`.
Your real `.env` files are not in the patch and are not overwritten.

## Part 3 — Dependencies
```powershell
cd $proj\backend;  npm install
cd $proj\frontend; npm install
cd $proj\ai-service;     .\venv\Scripts\activate; pip install -r requirements.txt
cd $proj\code-executor;  .\venv\Scripts\activate; pip install -r requirements.txt
```
(Use the same venvs you already have. Docker Desktop must be installed and running for Part 6.)

## Part 4 — Environment (three `.env` files; keep existing values, add the new ones)
Never commit `.env` files. Generate each secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
The backend now **refuses to start** if `JWT_SECRET` is missing or is the placeholder `change-me`, and prints warnings if the two service keys are missing.

1. `backend\.env` (see `backend\.env.example`). Required: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL=http://localhost:5173`, `AI_SERVICE_URL=http://localhost:8000`, `AI_SERVICE_API_KEY`, `CODE_EXECUTOR_URL=http://localhost:9000`, `CODE_EXECUTOR_API_KEY`.
   Optional [default]: `PORT` [5000], `RESUME_STORAGE_DIR` [backend\storage\resumes], `LOGIN_MAX_ATTEMPTS` [10], `REGISTER_MAX_PER_HOUR` [20], `INVITE_TTL_DAYS` [7], `ACCOUNT_ACTION_MAX_PER_15MIN` [10], `MAX_ASSESSMENT_ATTEMPTS` [5], `RUN_CODE_MAX_PER_MINUTE` [20], `API_MAX_PER_15MIN` [300].
   **For this test set `API_MAX_PER_15MIN=3000`**: all your test accounts share one IP address and the default 300 requests per 15 minutes can be exhausted by a long multi-account session (symptom: HTTP 429 everywhere).
2. `ai-service\.env`: `AI_SERVICE_API_KEY=<same value as backend>`, `PORT=8000`, `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5000`. (If the key is empty the service rejects every request.)
3. `code-executor\.env`: `CODE_EXECUTOR_API_KEY=<same value as backend>`, `PORT=9000`, `ALLOWED_ORIGINS=http://localhost:5000`. Leave the sandbox limits at their defaults.
4. `frontend\.env` only if the backend is not on port 5000: `VITE_API_BASE_URL=http://localhost:5000/api`.

## Part 5 — Migrations (ordered, additive, idempotent)
Stop the backend first. 001–006 should already be applied; re-running is harmless.
```powershell
cd $proj
foreach ($n in "001_user_roles","002_organizations","003_jobs","004_resumes","005_applications","006_job_assessments",
               "007_coding_problem_content","008_answer_evaluation_meta","009_coding_hint_reveals",
               "010_hiring_team","011_review_workflow","012_consent_audit_notifications") {
  Write-Host "== $n"
  psql -U postgres -d ai_interview_coach -v ON_ERROR_STOP=1 -f "database\migrations\$n.sql"
  if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED at $n"; break }
}
psql -U postgres -d ai_interview_coach -c "SELECT version FROM schema_migrations ORDER BY version;"
```
Expect 12 rows. The backend refuses to start (clear message) if any of 001–012 is missing. Existing data is kept; existing job applications have **no assessment consent**
(by design: candidates grant it from the application page before an assessment can start; hirers do not see assessment data without it).

Seed the original coding problems (14, with tests and reference solutions):
```powershell
cd $proj\backend
npm run seed:problems -- --dry-run      # preview
npm run seed:problems                   # idempotent; matches on slug only
npm run verify:problems                 # local reference-solution check; expect "All 14 problem(s) verified (locally)"
```

## Part 6 — Start the five services (five terminals)
1. **PostgreSQL** service running: `Get-Service *postgres*`.
2. **AI service:** `cd $proj\ai-service; .\venv\Scripts\activate; uvicorn app.main:app --port 8000`
3. **Code executor** (Docker Desktop running first): pre-pull the pinned images once —
   `docker pull python:3.12.3-slim; docker pull node:20.11.1-slim; docker pull eclipse-temurin:21.0.2_13-jdk-jammy; docker pull gcc:13.2.0` —
   then `cd $proj\code-executor; .\venv\Scripts\activate; uvicorn app.main:app --port 9000`. Do not loosen any Docker option (network off, memory/CPU/pid limits, read-only, no privileges).
4. **Backend:** `cd $proj\backend; npm run dev` → `AI Interview Coach API listening on http://localhost:5000`; open `http://localhost:5000/api/health`.
5. **Frontend:** `cd $proj\frontend; npm run dev` → `http://localhost:5173`.

Optional deeper check of Docker with the real problem bank (needs the backend `.env` with the executor URL/key) (this is what proves execution): `cd $proj\backend; node scripts\verify-coding-problems.js --executor`.

## Part 7 — Create admin, organization and test accounts
```powershell
# Register in the browser: admin@demo.com (candidate form). Then:
psql -U postgres -d ai_interview_coach -v email="admin@demo.com" -f database\seed\promote_admin.sql
```
Register `owner@demo.com` as "Hiring for a company" (company "Acme Corp"), log in as admin → **Organizations → Approve**.
Prepare these accounts: `cand1@demo.com`, `cand2@demo.com` (candidates); `recruiter@demo.com` and `reviewer@demo.com` (will join by invitation); `other@demo.com` as a hirer of a second company "Beta Ltd" (approved) for isolation checks.
Have one real PDF and one real DOCX resume ready.

## Part 8 — THE END-TO-END CHECKLIST
Use separate browser profiles per role. Button/page names below are descriptive and may differ slightly from the on-screen labels. Tick each row; "Expected" is the pass condition.

### A. Foundations and candidate basics
| # | As | Action | Expected |
|---|---|---|---|
| 1 | — | `/api/health`; AI service `http://localhost:8000/docs`; executor `http://localhost:9000/docs` | All respond. Backend log shows no migration warning |
| 2 | cand1 | Register, log in. Enter 11 wrong passwords | After the limit, login returns 429 (wait or restart backend to reset) |
| 3 | cand1 | **Profile**: set experience level, target role, language, skills; Save; refresh; log out/in | Values persist (loaded from the database) |
| 4 | cand1 | **Interview practice**: answer 2 questions; finish. Open **History** | Session appears in History from the DB; scores shown with an "advisory" label; low-confidence answers say so |
| 5 | cand1 | **Coding practice**: open a problem, press **Run Code** | Sample tests run, results shown; **no submission recorded and no attempt consumed** |
| 6 | cand1 | Submit wrong code, then correct code | Failed visible tests show expected vs actual; hints can be revealed; correct code passes all tests |
| 7 | cand1 | Upload resume PDF + DOCX; try `.txt` renamed `.pdf`; try >5 MB | Real files accepted; fake and oversized rejected (400) |
| 8 | cand1 | **My Resumes**: use the skill-suggestion button on a resume | Suggested skills shown; they change your profile only if you confirm |
| 9 | cand1 | Finish a practice interview with at least one weak answer; open the results page | "Follow-up questions to think about" appears for answers that missed concepts |
| 10 | **Docker proof** | Check the executor terminal during step 6 and run `docker ps -a` afterwards | Containers were created for Python (and try Java/C++/JS once each) and removed afterwards. **Only now may Docker execution be called verified** |

### B. Hiring team and job setup
| # | As | Action | Expected |
|---|---|---|---|
| 11 | owner | **Team → Invite** `recruiter@demo.com` as recruiter and `reviewer@demo.com` as reviewer; copy each link | Link looks like `/register?invite=<64 hex>`; no e-mail is sent (by design) |
| 12 | recruiter, reviewer | Open each link in a private window, register with the **same e-mail** | Joins Acme Corp without needing admin approval; a different e-mail with that link fails with a generic 400; reusing the link fails |
| 13 | recruiter | **Jobs → New job**; tick **Blind review**; edit scorecard criteria; add skills; configure assessment (interview + 1–2 coding problems); set **Open** | Saved; reviewer cannot create/edit jobs (403/hidden) |
| 14 | cand1 | **Job Board**: job visible; open its detail page | The job-fit panel lists matched/missing skills with an explanation (not a decision) |
| 15 | cand1 | Apply with a resume WITHOUT ticking resume-sharing consent | Rejected: consent required |
| 16 | cand1 | Apply, ticking ONLY the resume/profile consent box (leave the assessment box unticked) | Application *submitted*; second apply → 409 |
| 17 | cand1 | **My Applications → open** the application | Assessment consent shows "Not shared yet" and there is no **Start interview** button. Calling the start endpoint directly returns 403 |

### C. Assessment (hiring vs practice separation)
| # | As | Action | Expected |
|---|---|---|---|
| 18 | cand1 | Click **I agree** next to "Assessment results"; then **Start interview**; finish | One session linked to the application; same questions for every applicant (no adaptive difficulty) |
| 19 | cand1 | Submit the job coding problem (run through Docker) | Real execution; ≤5 attempts; results saved |
| 20 | cand1 | **Practice** pages and **History** | Job assessments do **not** appear in practice data |
| 21 | cand2 | Apply to same job, grant consent, do the assessment | Receives the same question set as cand1 |

### D. Recruiter workflow, privacy and trust
(The job from step 13 has **Blind review** on. cand1 and cand2 have both applied and finished the assessment.)
| # | As | Action | Expected |
|---|---|---|---|
| 22 | reviewer | **Job Openings → job → Applicants** | Candidate names/e-mails are masked while status is not shortlisted/hired; searching a candidate's real name finds nothing |
| 23 | reviewer | Open an application | "Blind review" banner; name, e-mail, resume and cover note hidden. Interview and coding results are visible because assessment consent was given; no speech/video metrics and no model answers. The assessment view is recorded in the access log |
| 24 | reviewer | Submit a scorecard (ratings + comment) | Saved; **no overall/total score** is computed anywhere |
| 25 | recruiter | Open the same application before submitting own scorecard | Reviewer's scorecard is hidden. After the recruiter submits their own, colleagues' scorecards become visible |
| 26 | recruiter | Set status **Shortlisted** | Names unmasked, resume text/download now available (each view/download is audited); candidate gets a notification |
| 27 | recruiter | **Reject** the other application with no reason; then reason "other" with a note shorter than 10 characters; then a valid reason | First two refused; third accepted |
| 28 | cand2 | **Notifications** | Status-change notice shows the neutral reason label only — never the internal note. |
| 29 | cand1 | Application detail → **Who has looked at my data** | Shows that the organization viewed your resume/assessment — never the individual |
| 30 | recruiter | Select 2+ applicants → **Compare** | Side-by-side evidence; no ranking score; comparison is audited |
| 31 | owner | **Access log** (sidebar, owner only) | Entries for steps 23, 26 and 30 with actor, time and type; recruiter and reviewer get 403 on `/api/hirer/audit-log` |
| 32 | recruiter | Open an under-review application, then the shortlisted one | **Hired** is offered only for the shortlisted one (the API refuses it from other states); after hiring, no further change is possible |

### E. Isolation and authorization (each should FAIL as shown)
```powershell
$base="http://localhost:5000/api"     # tokens: DevTools → Application → Local Storage → authToken
Invoke-RestMethod "$base/hirer/jobs" -Headers @{Authorization="Bearer <CANDIDATE>"}                 # 403
Invoke-RestMethod "$base/admin/organizations" -Headers @{Authorization="Bearer <HIRER>"}            # 403
Invoke-RestMethod "$base/hirer/applications/<APP_ID>" -Headers @{Authorization="Bearer <BETA_HIRER>"} # 404 (other org)
Invoke-RestMethod "$base/hirer/team" -Headers @{Authorization="Bearer <REVIEWER>"}                  # 403
Invoke-RestMethod "$base/resumes/<ID>/download" -Headers @{Authorization="Bearer <OTHER_CANDIDATE>"} # 404
Invoke-RestMethod "$base/jobs"                                                                       # 401
```
`Invoke-RestMethod` throws on 4xx; the error is the pass. Also confirm a hirer can never see practice sessions of a candidate (practice data is not linked to any application).

### F. Data rights
| # | As | Action | Expected |
|---|---|---|---|
| 33 | cand2 | **Account → Download my data → Download export** | JSON file (`ai-interview-coach-export-v1`) with profile, sessions, applications; no hirer notes |
| 34 | cand2 | **Account → Delete my account**: enter password, type DELETE, **Delete my account permanently** | Account, applications and resume files removed; re-login fails; audit rows remain without the person link |
| 35 | recruiter | Delete own account | Leaves the organization; jobs reassigned to an owner; org continues |
| 36 | owner | Try deleting sole-owner account while members/applications exist | Blocked (409) |
| 37 | admin | Try to delete own account | Refused |

### G. Evaluator study (no action needed to pass)
`validation\STUDY_STATUS.md` must say **PENDING**. Do not quote any accuracy for the interview evaluator until you complete the study (`validation\README.md`).

**Pass criteria:** every row behaves as Expected. Record failures with the backend/executor console output and send them back.

## Part 9 — Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Backend exits `Database is missing migration(s)` | Run Part 5, restart |
| `psql` not recognised | Add `C:\Program Files\PostgreSQL\<ver>\bin` to PATH |
| Coding run/submit returns executor error | Docker Desktop not running, images not pulled, executor not on :9000, or `CODE_EXECUTOR_API_KEY` mismatch |
| Interview scoring fails | AI service not on :8000 or `AI_SERVICE_API_KEY` mismatch |
| CORS error | `FRONTEND_URL` must equal the exact frontend origin |
| Hirer sees 403 "not approved" | Admin must approve the organization; log out/in |
| Invite link says invalid | Expired (`INVITE_TTL_DAYS`), already used, or registered with a different e-mail |
| Applicant cannot start assessment | Assessment consent not granted (step 17) — legacy applications need it too |
| 429 on login | Rate limit; wait 15 minutes or restart backend |
| Backend exits `[config] JWT_SECRET ...` | Set a real `JWT_SECRET` in `backend\.env` (Part 4) |
| HTTP 429 on many pages | `API_MAX_PER_15MIN` too low for a multi-account test; raise it and restart the backend |
| C++ or Java submission fails with a temp-file/permission error inside the container | Report the executor console output. The container now points `TMPDIR`/`HOME` at its writable `/workspace` tmpfs, but this has never run against real Docker |
| Java submission killed / `Resource temporarily unavailable` | The 64-process limit may be too tight for the JVM; report it rather than disabling limits (`PIDS_LIMIT` in `code-executor\.env` is the only knob; raise modestly, e.g. 128) |
| Frontend build error | Send the first error; JSX syntax was checked but `vite build` was never run |
| `pdf-parse` missing | App works; PDF text preview shows "unsupported" |

## Part 10 — Rollback
**Code:** restore folders from `$proj\_backups\<name>-<stamp>`; delete files listed in `CHANGED_FILES.txt` that did not exist before.
**Database A (cleanest):** `pg_restore -U postgres -d ai_interview_coach --clean --if-exists "$proj\_backups\db-<stamp>.dump"`
**Database B (down scripts, newest first, backend stopped):**
```powershell
foreach ($n in "012_consent_audit_notifications","011_review_workflow","010_hiring_team","009_coding_hint_reveals","008_answer_evaluation_meta","007_coding_problem_content") {
  psql -U postgres -d ai_interview_coach -v ON_ERROR_STOP=1 -f "database\migrations\$n.down.sql"
}
```
Data impact: 012 down deletes audit log, notifications and consent timestamps; 011 down deletes scorecards and blind-review settings; 010 down deletes invitations and **removes reviewer memberships**
(it does not promote them); 009/008 drop hint-reveal and evaluation-meta data; 007 drops problem content columns. Going below 007 follows the A–F guide's rollback. Old code runs on the migrated DB only up to the schema it expects, so restore code and DB together.
