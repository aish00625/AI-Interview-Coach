# Face behaviour monitoring (optional, practice only)

An opt-in camera check for **practice interviews**. It produces observations for the candidate to review. It is not a cheating detector, it never disqualifies anyone, and it has no effect on interview scores, coding results or Docker execution.

Open it from the sidebar: **Camera check (beta)** (`/face-monitoring`). Optional link to one practice interview: `/face-monitoring?interview=<id>`. Hiring-assessment sessions are refused (`practice_only`).

## What is real, rule-based or unavailable

| Capability | How it is produced | When it is unavailable |
|---|---|---|
| A. Face detection (present / none / unusable frame) | **Real model**: MediaPipe FaceLandmarker if its model file exists, else OpenCV Haar cascade (frontal faces only). Confidence is **not reported** (neither detector gives a calibrated one). | OpenCV missing: the whole module says so and cannot start. |
| B. Multiple faces | Face count from the same detector, then **rule-based** timing in Node: a run longer than the threshold becomes one event with start, end, duration. | Same as A. |
| C. Eye gaze | **Real, rough**: horizontal iris offset from MediaPipe landmarks, only when the eyes are large enough, the head is roughly frontal and the result is stable. Otherwise `low_confidence` or `unavailable`. It is **not** an eye tracker and head pose is never labelled gaze. | Needs the landmark model. |
| D. Head pose | **Real**: yaw / pitch / roll from the landmarker's transformation matrix. Prolonged deviation is a **rule-based** event. | Needs the landmark model. |
| E. Same-person check | **Real model, optional**: OpenCV SFace embeddings compared with a photo taken at the start. States: `not_configured`, `unavailable`, `verified`, `verification_failed`. The reference stays in AI-service memory only, has a time limit, is deleted when the session ends, and no embedding is ever returned or stored. Separate consent. Not legal ID verification. | Needs the SFace ONNX file **and** the landmark model. |
| F. Absence | **Rule-based**: no-face runs over a threshold. Dark / blurred frames, camera outages, pauses and missing-frame gaps are **not** counted as absence. | Same as A. |
| G. Review flags | **Rule-based, explainable**: every event and flag carries the measurement and threshold behind it. Categories: `observation`, `warning`, `technical_issue`, `review_recommended`. Never a verdict. | Needs data (otherwise "not enough data"). |
| H. Camera / visibility | Browser camera errors (permission, no device, in use, unplugged) and image quality (brightness, contrast, sharpness) are reported as `technical_issue`, with actionable messages. Camera tracks are stopped on pause, end, leaving the page and unmount (resume reopens the camera). | n/a |

Unavailable or unreliable values are shown as *Unavailable / Low confidence / Not enough data*, never as zero.

## Not done on purpose
No emotion, honesty, attention or intent inference. No video, image or face template is stored or logged. Frames are not sent to any outside service. Reports are visible to the candidate only (no hirer/reviewer access). No automatic score deductions.

## How it flows
Browser (consent, camera, one 640 px JPEG about every 2 s) → Node `POST /api/face-monitoring/sessions/:id/frames` (auth, candidate role, ownership, size/type checks, rate limit) → Python `POST /face-frame` (stateless analysis in memory) → Node timing engine (server clock; the client never sends times, scores, severities or results) → PostgreSQL (events and a compact state). Frames are discarded.

## API (all candidate-only, mounted at `/api/face-monitoring`)
`GET /capabilities` · `GET /sessions` · `POST /sessions` (`consent: true` required; optional `identityConsent`, `interviewSessionId`) · `GET /sessions/:id` · `GET /sessions/:id/report` · `POST /sessions/:id/frames` (multipart `frame`) · `POST /sessions/:id/reference` (multipart `frame`) · `POST /sessions/:id/camera-status` · `POST /sessions/:id/pause` · `POST /sessions/:id/resume` · `POST /sessions/:id/end` · `DELETE /sessions/:id`.

AI service: `POST /face-frame`, `POST /face-reference`, `DELETE /face-reference/{key}`; `/capabilities` gains `faceMonitor`.

One running session per candidate (409 `session_already_running`). Errors: 400 `consent_required` / `practice_only`, 409 for a paused/ended session, 413/415/422 for bad frames, 503 when the AI service is down or the module is unavailable.

## Database
Migration `017_face_monitoring.sql` (additive; `.down.sql` provided): tables `face_monitoring_sessions` and `face_monitoring_events`, with consent version/time, identity consent, retention date, check constraints, indexes and a partial unique index for one running session. `016_score_breakdown.sql` is from the scoring change. Existing data is untouched. Deleting the account cascades; the account export includes `faceMonitoringSessions` (measurements and events only).

## Setup (Windows)
```powershell
# 1. migrations (idempotent, additive): applies 016 and 017 along with the rest
powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1

# 2. optional: head pose + gaze (downloads MediaPipe's official small model, with your OK)
cd ai-service
.\.venv\Scripts\python.exe -m app.diagnostics --download-vision-model

# 3. optional: same-person check. NOT downloaded for you. Get face_recognition_sface_2021dec.onnx from the OpenCV model zoo yourself,
#    verify its hash, then set in ai-service\.env:
#    FACE_RECOGNITION_MODEL_PATH=C:\path\to\face_recognition_sface_2021dec.onnx

# 4. check what is available
.\.venv\Scripts\python.exe -m app.diagnostics
```
Restart the AI service after changing `.env`. Packages needed by the AI service: `opencv-python` and `numpy` (already required by the webcam analysis); `mediapipe` for the landmark features.

## Settings (all optional; defaults shown in `backend/.env.example` and `ai-service/.env.example`)
Thresholds (`FACE_ABSENCE_SEC`, `FACE_MULTI_SEC`, `FACE_HEAD_*`, `FACE_GAZE_*`), `FACE_MONITOR_RETENTION_DAYS` (default 30; expired rows are purged when a new session is created), rate limits, `AI_SERVICE_FACE_TIMEOUT_MS`. Invalid values are ignored with a warning in `GET /capabilities`.

## Tests
```powershell
cd ai-service ; python -m unittest discover -s tests          # per-frame logic with fake detectors
cd ..\backend  ; npm test                                     # engine, sessions, auth, ownership, report, retention
cd ..\frontend ; npm test ; npm run build                     # status/cards/timeline view-models, camera controller
```
The Python tests use fakes, so they prove the logic, not the accuracy of MediaPipe, Haar or SFace. Check accuracy on your own camera.

## Known limits
Haar detects frontal faces only; gaze is horizontal and rough; glasses, lighting and webcam angle change results; there is no per-face confidence; the same-person check is not identity proofing; a page reload stops the camera (the session can be continued from the page); background tabs may slow the timer, which shows up as a "no frames" gap, not as absence.
