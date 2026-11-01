# Phase M - speech, audio/video analysis, typing tracking and delivery feedback

See `WINDOWS_SETUP_GUIDE.md` Section 2 for what changed and Section 9 for exactly what was and was not verified.

* Migration: `database/migrations/013_typing_metrics.sql` (+ `.down.sql`). Required at backend start-up.
* Backend: `services/aiServiceClient.js` (structured errors, nullable speech fields, capabilities), `utils/typingMetrics.js`,
  `utils/behaviorScoring.js`, `GET /api/interviews/capabilities`, `typingMetrics` on `POST /api/interviews/:id/answer`,
  `answer.behavior_summary` + `delivery` on `GET /api/interviews/:id`. Tests: `backend/tests/phaseM/`.
* AI service: rewritten speech pipeline (`app/services/audio_quality.py`, `speech_processor.py`), adaptive video sampler, `/capabilities`,
  `python -m app.diagnostics`, split requirements files. Tests: `ai-service/tests/`.
* Frontend: `LiveInterview.jsx` (typing capture, capabilities banner, reason-based errors with retry, camera recorded alongside voice),
  `InterviewResults.jsx` + `components/DeliveryPanel.jsx`, `utils/typingTracker.js`, `utils/aiErrors.js` (tests: `npm test`).
* Privacy: typing telemetry and delivery summaries are practice-only, are never selected by hirer queries, and are excluded from `final_score`.
- Coding problems: 32 new problems under backend/data/coding-problems (46 total); see WINDOWS_SETUP_GUIDE.md 6b.
