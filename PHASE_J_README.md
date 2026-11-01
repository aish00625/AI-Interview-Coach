# Phase J — Recruiter evidence, privacy and trust

Status key: **Impl** = code written · **Unit** = pure-logic tests · **DB** = route chains + real PostgreSQL 16 in the sandbox (real guards, controllers, services, SQL; express/validators/bcrypt/JWT/multer stubbed) · **E2E** = verified in a browser against the running stack (NOT yet — the final Windows test).

| Feature | Impl | Unit | DB | E2E |
|---|---|---|---|---|
| Structured scorecards (per-job criteria, 1–5 ratings, recommendation) | yes | yes | yes | no |
| Independent scoring (colleagues' scorecards hidden until yours is in) | yes | – | yes | no |
| Blind review (name, e-mail, resume, cover note masked **in SQL** until shortlisted) | yes | – | yes | no |
| Required, structured rejection reason; candidate sees a neutral label only | yes | yes | yes | no |
| Hiring-team invitations (single-use, hashed, expiring, e-mail-bound) | yes | yes | yes | no |
| Org-scoped roles: owner / recruiter / reviewer, enforced server-side | yes | yes | yes | no |
| Candidate consent (resume+profile at apply; assessment results) | yes | – | yes | no |
| Access audit log (fail-closed) + candidate-visible access record | yes | – | yes | no |
| In-app notifications on status change (same transaction) | yes | yes | yes | no |
| Data export (JSON) | yes | – | yes | no |
| Account deletion incl. resume-file purge via `resumeService.purgeFiles` | yes | – | yes | no |
| Migrations 010–012 up / re-run / down / up again | yes | – | yes | no |
| React screens (Team, Access log, Notifications, Account, Scorecard, Reject dialog, consent steps) | yes | static wiring checks | – | no |

## Rules enforced (server-side)
- **Roles** come from `organization_members` and are re-read from the database on every request. `owner`: everything. `recruiter`: jobs + decisions + review. `reviewer`: read, notes, scorecards only. Only an existing owner can create owners (invitations can only create recruiter / reviewer).
- **Blind review** hides identity while the application is *submitted / under review / rejected*; it is revealed when *shortlisted or hired*. Name search cannot be used to unmask. Interview answers and code are still shown and may contain personal details (documented limit).
- **Consent** is explicit: applying requires agreeing to share the resume + profile; the job assessment (interview/coding) cannot be started or submitted until the candidate agrees to share its results. Applications created before this version have **no consent recorded and are not back-filled**: the hirer sees "not shared" until the candidate agrees on the application page. Consent can be granted, never silently revoked; withdrawing ends sharing, and re-applying asks again.
- **Audit**: opening resume text, downloading a resume, viewing assessment data, or including a candidate in a comparison writes an `access_audit_log` row *before* the data is returned; if the write fails the request fails. Summary list views (no resume text or answers) are not logged. Candidates see "Someone at <Org> viewed your resume" — never who.
- **Decisions stay human**: no score computes a rating or status. Scorecards have no aggregate. Rejection needs a reason code (and an explanation for "other"); the hiring team's free-text note is never shown to candidates.
- **Deletion**: candidate → applications (and everything hanging off them), practice data, resumes **and files** are removed; audit rows are kept with the references emptied. Hirer members leave (their notes/scorecards stay, author removed; jobs they created move to an owner). A sole owner is blocked while the org has other members or candidate applications. Admins cannot self-delete via the API.

## Migrations (additive, with rollbacks; apply 010 → 011 → 012)
- `010_hiring_team` — `organization_invitations`; member role `reviewer`. Down: removes reviewer memberships (does **not** promote them).
- `011_review_workflow` — `job_openings.blind_review`, `.scorecard_criteria`; scorecard tables; `application_status_history.reason_code`. Down: **deletes** scorecards and reason codes.
- `012_consent_audit_notifications` — `applications.consent_*`; `access_audit_log`; `notifications`. Down: **deletes** the audit log, notifications and recorded consents.

## Caveats (not claimed)
- No e-mail is sent anywhere: invitation links are copied by the owner; notifications are in-app only.
- Invitations create **new** hiring accounts; an e-mail that already has an account cannot be invited.
- The React build and a real browser have not been run; Express wiring, express-validator rules, multer and the real bcrypt/JWT are stubbed in the sandbox tests (the validators for the new routes are therefore only exercised in the Windows test).
- Account deletion removes files best-effort after the database commit; a failed file delete leaves an orphan that `resumeReconcile` reports.
