# Skip, go back, answer again

Available in practice interviews and in hiring assessments, text and voice.

## What the candidate can do
* **Skip question** (only on a question with no answer yet). The question is stored with four scores of 0 and the status **Skipped**.
  Nothing is sent to the AI service. It counts as 0 in the session score (the same rule as an answer that could not be evaluated).
* **Previous question**. Any earlier question can be reopened while the interview is still in progress.
* **Answer again**. Reopening an answered (or skipped) question and submitting a new answer **replaces** it in the score.
  The earlier attempt is kept in the answer's history (`evaluation_meta.previousAttempts`, last 5, each with time, skipped flag, status,
  average and a 500-character preview) and the new answer carries `evaluation_meta.attemptCount`.
* **Continue without answering**: on a reopened question, moves on and leaves the existing answer or skip as it was.
* Once the interview is completed nothing can be skipped or changed (409).

## Rules and side effects
* No database migration: `interview_answers` already has one row per question; a retry is an upsert on `question_id`, and the
  history lives in the existing `evaluation_meta` JSONB column.
* A retry clears the old camera analysis (`cv_metrics`) so a new clip can be attached, and deletes saved STAR coaching for that question
  (it described the old answer). Follow-up prompts are kept; they relate to the earlier attempt and never affect a score.
* Session score, dashboard averages and the hirer's "average" figures include skipped questions as 0.

## What hiring teams see
On the application review page a skipped answer reads "Skipped by the candidate (counts as 0)", an answer given more than once shows
"Answered N times; the latest attempt is shown". Hirer queries read exactly three fields out of `evaluation_meta`: `answerQuality.status`,
`confidence` and `attemptCount`. Earlier attempts and their text previews are never selected (guard test in `tests/phaseH/evaluation_meta.test.js`).

## Where it lives
Backend: `POST /api/interviews/:id/skip`, `services/interviewService.js` (`skipQuestion`, `attemptMeta`), `models/interviewModel.js`
(`createAnswer(..., { replace })`), `utils/answerQuality.js`. Frontend: `pages/LiveInterview.jsx`, `utils/resultsView.js` (`attemptsView`),
`components/ResultsQuestionView.jsx`, `pages/HirerApplicationReview.jsx`. Tests: `backend/tests/phaseT/skip_retry.test.js` (real PostgreSQL).
