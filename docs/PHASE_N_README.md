# Phase N - premium upgrade (what changed, how to apply)

New migration: **014_user_goals** (additive; `user_goals` table; down script included). The backend refuses to start until it is applied
(startup migration guard). Apply with `scripts\windows\upgrade-existing-install.ps1` (or `setup.ps1`); both apply migrations 001-014 without dropping data.

New/changed endpoints (all authenticated, scoped to the caller on the server):
- GET `/api/dashboard/preparation`, PUT `/api/dashboard/goals` (candidate)
- GET `/api/interviews/:id/comparison` (candidate, own completed practice sessions only)
- GET `/api/coding/progress` (candidate; solved/attempted per problem, no code or tests)
- GET `/api/admin/overview`, GET `/api/admin/service-health` (admin)
- GET `/api/hirer/dashboard` now also returns applicationsByWeek, firstReview and per-job under_review/hired.

Tests run in the sandbox against a real PostgreSQL: full backend suite (see final report). Not run: browser rendering, `vite build`, Docker, Windows scripts.
See `PRODUCT_UPGRADE_ROADMAP.md` for what is done, partial and planned.
