# AI Interview Coach — Windows setup and verification guide (final consolidated project, Phases A–M)

Project folder assumed: `C:\Users\Aishu\Downloads\major`. All commands are PowerShell. **Nothing here drops or resets your database.**

> **Honest status.** This project was developed and tested in a Linux sandbox. **Nothing in it has been run on your Windows laptop yet.**
> Section 9 lists exactly what was run in the sandbox and what was not. Voice transcription accuracy, the speech-model download, the React build,
> any browser behaviour, the FastAPI HTTP layer, the PowerShell scripts and Docker code execution are **unverified until you run Section 6**.
> Do not treat the speech, camera, typing or delivery-score features as working until the matching row in Section 6 passes.

---
## 1. What you have to do yourself, and why

| # | When | What | Why only you can |
|---|---|---|---|
| 1 | Once | Back up the folder and the database (Section 3) | Your data is on your laptop |
| 2 | Once | Extract `AI-Interview-Coach-FINAL.zip` over the project folder (Section 4) | The files must land on your disk |
| 3 | Once | Run `scripts\windows\setup.ps1`; type your **PostgreSQL password** when asked | Only you know it. It is written to `backend\.env` and nowhere else |
| 4 | Once, automatic but slow | Let the setup download the speech model (about **460 MB**) and the Python packages | Needs your internet connection |
| 5 | Once, only for coding rounds | Install/start **Docker Desktop** and pull four images (Section 5) | Docker runs on your machine |
| 6 | Each session | Run `scripts\windows\start-all.ps1` | Starts the services |
| 7 | Once | Allow the **microphone and camera** in the browser when asked | Browser permission prompts cannot be answered for you |
| 8 | Once | Perform the checks in Section 6 and send me anything that fails (with the service window text) | This is the real-environment verification |

Optional: if you want head-direction/gaze analysis from the webcam, run setup with `-WithVision` (adds ~300 MB of packages and a small model file).
You never have to edit code or merge files. `.env` files are created for you with generated secrets; **existing `.env` values are never changed**, new keys are only appended.

## 2. What changed in this version (summary)

* **Speech-to-text.** Local Whisper (faster-whisper) now uses the `small` model by default, beam search, voice-activity filtering, an English language hint,
  a vocabulary prompt, quiet-audio boost, silence/hallucination filtering, and reports a **transcript confidence** (a certainty heuristic, *not* a measured accuracy).
  The old default (`base`, greedy decoding, no language hint) was the main cause of the earlier inaccurate transcripts.
* **The `/speech-evaluate` 503.** Root causes found: (a) the backend rejected perfectly valid results for short answers because it required a numeric speaking rate that
  is correctly `null` when there is too little speech; (b) every AI failure was collapsed into one generic 503 so the real reason was hidden; (c) a 30-second timeout was shorter than a
  first-time model load; (d) the model loaded lazily on the first answer; (e) the speech package or model download may be missing on a machine. Now: nullable fields accepted, the model preloads at start,
  timeout is 120 s (`AI_SERVICE_SPEECH_TIMEOUT_MS`), and every failure carries a `reason` that the screen turns into a specific instruction (Section 8).
* **Audio analysis.** Measured, not judged: speaking pace and articulation rate, filler words/false starts per 100 words, pauses and long pauses (from word timestamps), time to first word, recording quality.
* **Video analysis.** Frames are sampled across the **whole** clip (the old sampler only looked at the first ~1.5 s of browser recordings). You can now record the camera **while** answering a voice question.
  Face presence always; head direction/gaze only with the optional model. No emotion, confidence or personality inference.
* **Typing speed tracking** for practice text answers: counts and timings only (never which keys), re-derived on the server.
* **Delivery (behaviour) score**: an advisory 0–100 summary of the measurable signals above, shown on the results page. It is **separate from, and never part of, the interview score**,
  its thresholds are simple rules of thumb that have **not been validated**, it is never shown to hirers, and nothing in the system rejects or ranks anyone because of it.
* **Database:** one additive migration `013_typing_metrics` (a nullable column, with a down script).
* All Phase A–K features are preserved (their tests still pass; see Section 9).

## 3. Back up (do not skip)
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
(`robocopy` exit codes 0–7 mean success.) Also copy your resume folder (`RESUME_STORAGE_DIR`, default `backend\uploads\resumes`).

## 4. Apply the project
```powershell
Get-FileHash "$env:USERPROFILE\Downloads\AI-Interview-Coach-FINAL.zip" -Algorithm SHA256   # compare with SHA256SUMS.txt
Expand-Archive "$env:USERPROFILE\Downloads\AI-Interview-Coach-FINAL.zip" "$env:USERPROFILE\Downloads\aic-final" -Force
robocopy "$env:USERPROFILE\Downloads\aic-final\AI-Interview-Coach" $proj /E /XF .env | Out-Null
```
The ZIP is the **whole project** (it replaces every earlier patch; do not also apply those). It contains no `.env`, `node_modules`, `venv` or database, so nothing of yours is overwritten except source files.
If your backend/frontend live one level deeper than `$proj\backend`, tell me before copying.

## 5. One-time setup (installs packages, creates `.env` files, applies migrations, checks speech)
```powershell
cd $proj
powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1            # add -WithVision for webcam head/gaze packages
```
It asks for your PostgreSQL password only if `backend\.env` does not exist yet. At the end it runs `python -m app.diagnostics`, which downloads the speech model once and prints
`[ok]` or `[FAIL]` lines. **If you see `[FAIL]`, copy those lines to me**; text interviews still work.
If your existing `ai-service\.env` says `SPEECH_MODEL_SIZE=base` (the old default), the script keeps it and prints a note: change it to `small` for better accuracy.
Prerequisites it cannot install for you: Node.js 20+, Python 3.11/3.12 (tick "Add to PATH"), PostgreSQL with `psql` on PATH.

**Coding rounds only:** install Docker Desktop, start it, then pull the pinned images once:
`docker pull python:3.12.3-slim; docker pull node:20.11.1-slim; docker pull eclipse-temurin:21.0.2_13-jdk-jammy; docker pull gcc:13.2.0`

## 6. Start everything and verify
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\start-all.ps1 -WithExecutor     # omit -WithExecutor if Docker is not running
```
Open `http://localhost:5173` in **Chrome or Edge**. The AI-service window prints when the speech model has finished loading; you can already use text answers.

Tick each row. "Expected" is the pass condition. Record the AI-service window text for any failure.

### Speech, camera, typing and delivery (new in this version)
| # | Action | Expected |
|---|---|---|
| V1 | In a second terminal: `cd $proj\ai-service; .\venv\Scripts\python.exe -m app.diagnostics` | `[ok]` for package, model load and decoding |
| V2 | Start a practice interview in **Voice** mode, right after starting the AI service | A notice says the speech model is starting; once loaded it disappears |
| V3 | Record a 20–30 s answer (allow the microphone) | Transcript appears on the results page; speech measurements shown; no 503 |
| V4 | **Accuracy check (yours to judge):** read three known sentences aloud, including technical words (e.g. "A deadlock happens when two processes wait for each other"). Compare to the transcript | Note any wrong words. Do not treat the confidence label as accuracy. If it is poor, set `SPEECH_MODEL_SIZE=medium` in `ai-service\.env` and restart the AI service (slower) |
| V5 | Record a **very short** answer (2–3 words) | Answer is scored (this used to 503); speaking rate absent rather than 0 |
| V6 | Press record and stay silent for 5 s | Message "No speech was detected…" and you can record again; nothing stored |
| V7 | Stop the AI service, record an answer | Message says the AI service could not be reached; **Try again with the same recording** works after restarting it |
| V8 | Put a wrong `AI_SERVICE_API_KEY` in `ai-service\.env`, restart it, record | Message names the key mismatch. Restore the key afterwards |
| V9 | Voice mode: tick **Also record my camera while I answer**, answer for ~30 s | Answer saved first, then camera analysis; results show "frames analysed (sampled across N in the clip)". Head/gaze only if you installed the vision model |
| V10 | Deny the camera permission but allow the microphone | Falls back to audio-only with a note |
| V11 | Text mode: type an answer (~60 words), pause once for 4+ s, delete a few words; submit | Results show typing speed, deletions %, long pauses |
| V12 | Text mode: paste a paragraph then submit | Results show the pasted share, described neutrally |
| V13 | Open results | A **Delivery feedback (advisory)** panel with component bars and the line that it is not part of the interview score; session roll-up near the final score; **final score equals the average of the four content scores as before** |
| V14 | Run the migration check: `psql -U postgres -d ai_interview_coach -c "SELECT version FROM schema_migrations ORDER BY 1 DESC LIMIT 2;"` | `013_typing_metrics` present |
| V15 | Log in as a hirer on a job with an assessment; open an applicant | **No** speech, camera, typing or delivery data anywhere (these are practice-only) |
| V16 | **Account → Download my data** | Export contains your own typing metrics |

### Phases A–K
Run the full checklist in `docs\CHECKLIST_PHASES_A-K.md` (Part 8 there). Ignore its Parts 0–5 (replaced by Sections 4–5 above).

## 6b. Coding problems (46 in the bank)
The bank now has **46 problems** (14 original + 32 new) across all 12 topics: Arrays, Strings, Hashing, Linked Lists, Stack, Queue, Trees, Graphs, Recursion, Dynamic Programming, Sorting and Searching, at easy/medium/hard difficulty.
`setup.ps1` seeds them; to add them to an already-set-up database, run: `cd $proj\backend; npm run seed:problems; npm run verify:problems` (the seeder is idempotent, matched on slug, and the verifier should end with `All 46 problem(s) verified (locally)`).
The tests were checked in the sandbox with independent Python/JavaScript solutions; the tests are small (inputs are capped at about 30,000 characters) so they check correctness but do not strictly enforce time limits. They have **not** been run through the Docker executor: `node scripts\verify-coding-problems.js --executor` does that once Docker is running.

## 7. Updating `.env` values by hand (only if you want to)
* `backend\.env`: `AI_SERVICE_SPEECH_TIMEOUT_MS=120000` (raise on a slow PC), `AI_SERVICE_API_KEY` (must equal `ai-service\.env`).
* `ai-service\.env`: `SPEECH_MODEL_SIZE` (`base` faster/less accurate · `small` default · `medium` slower/more accurate), `SPEECH_LANGUAGE=en` (empty = auto-detect), `SPEECH_LOCAL_ONLY=true` after the first download to forbid network access.
* Restart the affected service after any change.

## 8. Troubleshooting voice and camera
| What the screen says | Meaning / fix |
|---|---|
| "The speech model is still starting up…" | Wait; the first start loads (and the very first time downloads) the model. Watch the AI-service window |
| "…speech add-on installed on the AI service" (`speech_package_missing`) | `cd ai-service; .\venv\Scripts\python.exe -m pip install -r requirements-speech.txt`, restart the AI service |
| "…model could not be loaded" (`speech_model_unavailable`) | Usually no internet for the first download, or a full disk. Run `python -m app.diagnostics` and read the `[FAIL]` line |
| "The AI service could not be reached" | AI service window closed/crashed; `AI_SERVICE_URL` in `backend\.env` must be `http://localhost:8000` |
| "…different AI_SERVICE_API_KEY values" | Make the value identical in both `.env` files; restart both |
| "…took too long" | First request after a cold start; try again, or raise `AI_SERVICE_SPEECH_TIMEOUT_MS` |
| "No speech was detected" / "too quiet" | Check the selected microphone in Windows Sound settings; speak closer |
| Camera analysis not available | Not installed: re-run setup with `-WithVision`. Your answer is saved without it |
| Backend exits `Database is missing migration(s)` | Re-run `setup.ps1` (it applies 001–013) |
| Everything else | See the troubleshooting table in `docs\CHECKLIST_PHASES_A-K.md` Part 9 |

## 9. Verification status (what was and was not run)
| Item | Status |
|---|---|
| Node backend: 256 tests (coding-problem bank included) (real PostgreSQL via a test harness: route chains, services, models, privacy, migrations up/down) | **Run in the sandbox, all pass** |
| AI service: 95 unit tests (audio checks, speech metrics, confidence, transcript filtering with a *fake* Whisper model, route error mapping with a FastAPI stub, video sampler, diagnostics) | **Run in the sandbox, all pass** (1 skipped: the OpenCV build in the sandbox has no face detector) |
| Code executor 14 tests, validation tools 23 tests, 14 coding-problem reference checks, frontend utility tests 6, JSX syntax check of 75 files | **Run in the sandbox, all pass** |
| Migration 013 up → down → up on PostgreSQL | **Run in the sandbox** |
| React components rendering (DeliveryPanel) via server-side render | **Run in the sandbox** (a smoke test, not a browser) |
| Real Whisper transcription and its accuracy; the model download | **NOT run anywhere** — Section 6 V1–V6 |
| Real FastAPI/uvicorn server, Express server, express-validator, multer, bcrypt/JWT, pdf-parse | **NOT run** (packages not installable in the sandbox) |
| `vite build`, a real browser, MediaRecorder, microphone/camera behaviour | **NOT run** |
| OpenCV face detection, MediaPipe head/gaze on real video | **NOT run** |
| `setup.ps1` and `start-all.ps1` | **NOT run** (no PowerShell in the sandbox; written for Windows PowerShell 5.1) |
| Docker code execution | **NOT run** — verified only when Part 8 step 10 of the A–K checklist passes |
| Delivery-score thresholds, transcript-confidence labels | Rules of thumb, **not validated** against outcomes |

## 10. Rollback
Code: restore from `$proj\_backups`. Database: `pg_restore -U postgres -d ai_interview_coach --clean --if-exists "$proj\_backups\db-<stamp>.dump"`, or only undo this version's migration (stop the backend first):
```powershell
psql -U postgres -d ai_interview_coach -v ON_ERROR_STOP=1 -f database\migrations\013_typing_metrics.down.sql
```
That drops only the typing telemetry column; answers and scores are kept. Older migrations' rollback steps are in `docs\CHECKLIST_PHASES_A-K.md` Part 10.
