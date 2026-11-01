# Product upgrade roadmap (Phase N)

Status legend: **Done** = implemented and covered by tests that were run; **Done (UI unverified)** = implemented, statically checked only (syntax, imports, undeclared identifiers, wiring tests) but never rendered in a browser; **Partial**; **Planned**.

Ground rules that every item below respects: additive migrations only, no data reset, practice data stays private from hirers, AI scores are advisory and nothing is decided automatically, no paid APIs, no invented data (empty states instead).

## P0 - foundation and the highest-value candidate/hirer/admin views

| Item | Why | Depends on | Status |
|---|---|---|---|
| Design system v2 (tokens, PageHeader, Panel, StatCard, Badge, Skeleton, ChartTooltip, skip link, focus states, reduced motion, responsive sidebar) | One look across pages; accessibility; mobile layout | - | Done (UI unverified) |
| Candidate command-center dashboard (readiness, weekly goals, next steps, continue-interview, review queue) | Gives the candidate one place that says what to do next | `/dashboard/preparation`, migration 014 | Backend Done + tested; UI Done (unverified) |
| Progress page (heatmap, streaks, knowledge-gap map, per-language/difficulty/topic analytics) | Evidence behind each number | `/performance`, `/dashboard/preparation` | Backend Done + tested; UI Done (unverified) |
| Hirer ATS dashboard (pipeline funnel, applications per week, time to first review, per-job funnel) | Core recruiter workflow visibility | `/hirer/dashboard` | Backend Done + tested; UI Done (unverified) |
| Admin overview (real counts, weekly trends, live service health incl. code-executor probe) | Operators need to see whether the system is working | `/admin/overview`, `/admin/service-health` | Backend Done + tested; UI Done (unverified) |

## P1 - personalisation and transparency

| Item | Why | Depends on | Status |
|---|---|---|---|
| Weekly goals (user-set, 0-50 interviews, 0-200 problems) | Self-set targets, no defaults invented for the user | migration 014 | Done (backend tested; UI unverified) |
| Previous-attempt comparison on interview results | Shows whether practice helps; says so when questions differ | `/interviews/:id/comparison` | Done (backend tested; UI unverified) |
| Scoring guide on results page | Rubric transparency | - | Done (UI unverified) |
| Spaced-repetition review queue | Revisit weak topics on a schedule (1/3/7/14 days by score band), computed on read | topic stats | Done (backend tested) |
| Knowledge-gap map with confidence levels | Honest "weak / developing / strong / not enough data" | topic stats | Done (backend tested) |
| Coding list: solved/attempted badges and status filter | Navigate 46 problems by progress | `/coding/progress` | Done (backend tested; UI unverified) |
| Suggested next steps (max 5, built only from real facts) | Actionable without a model | pure rules | Done (unit tested) |

## P2 - not done in this phase

| Item | Notes | Status |
|---|---|---|
| Hirer candidate comparison view, scorecards, blind review mode | Existing application-review pages were kept as they are; a side-by-side comparison would need a new endpoint with careful field filtering (blind mode must hide name/contact server-side, not in CSS) | Planned |
| Design-system rollout to remaining pages (live interview, setup, job board, hirer job forms, coding workspace) | Pages still work with the older styling | Partial |
| Adaptive interview difficulty | A rule exists for suggested coding difficulty (by topic solve rate); wiring it into interview setup is not done | Partial |
| Resume/webcam/speech improvements | Existing features unchanged; not re-verified | Planned |

## P3 - ideas that need more than "no paid APIs, no invented data" allows

- Multi-turn interviewer, STAR coaching and a coding coach: **done in Phase O with a free local model** (see PHASE_O_README.md); advisory only, answer quality of a real model not yet verified.
- Predictive hiring scores (would be a consequential AI decision; deliberately not planned).

## Known limits

- Readiness, topic standing and review intervals are transparent heuristics, not validated measures; the API returns their methodology and limitations and the UI shows them.
- Nothing in this phase has been run in a browser, against Docker, or on the Windows machine. Migration 014 must be applied before the backend starts (startup guard).
