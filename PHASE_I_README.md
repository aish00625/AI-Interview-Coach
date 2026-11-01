# Phase I — Candidate intelligence

Status key: **Impl** = code written · **Unit** = pure-logic tests · **DB** = tests against a real PostgreSQL 16 (sandbox) · **E2E** = verified in a browser against the running stack (NOT yet — happens in the final Windows test).

| Feature | Impl | Unit | DB | E2E |
|---|---|---|---|---|
| Run Code on sample tests (no submission, no attempt used, rate-limited) | yes | yes | yes | no |
| Failed-test feedback + expected-vs-actual (visible tests only) | yes | yes | yes | no |
| Authored hints (withheld during active-application assessments) | yes | yes | yes | no |
| Executor contract v1.1 (optional output echo, per-test timing) | yes | yes (fake runner) | – | no (needs Docker) |
| Skill synonyms / canonical names (profile + job skills) | yes | yes | yes | no |
| Resume skill suggestions (never auto-saved) | yes | yes | yes | no |
| Explainable job-fit view (open jobs, own resume only) | yes | yes | yes | no |
| Personalised practice questions (skills, role, weak topics) | yes | yes | yes | no |
| Adaptive difficulty (private practice only) | yes | yes | yes | no |
| Targeted follow-ups from missing rubric criteria (practice only) | yes | yes (Python) | yes | no |

## Rules enforced
- **Hiring assessments are identical for all applicants.** `personalize`/`adaptive` are ignored when `applicationId` is set; the question list equals the original deterministic selection (tested). 18 new practice-only questions never enter the hiring pool.
- Practice weak-topic data is read only from the user's own practice answers (`application_id IS NULL`).
- Hidden tests never get `returnOutput`; hints are not served for problems in an active assessment.
- Job fit is advisory, explained per skill, and nothing is stored.

## Not done / caveats
- Memory usage is not measured; complexity analysis is not attempted.
- Executor v1.1 and Run Code through Docker are untested against a real daemon.
- Skill extraction is keyword/alias based, not semantic.
- Express wiring, multer, React rendering and the AI-service HTTP layer have not been run.
