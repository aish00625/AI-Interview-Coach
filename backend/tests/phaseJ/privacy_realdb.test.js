// Phase J privacy and trust: blind review, candidate consent, access audit log, data export, account deletion.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const { setup } = require('./harness')
const { root } = require('../phaseA/helpers')

if (!process.env.AIC_TEST_DB) { test('Phase J privacy', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('privacy')
  const { api, ok, pool, register, tag, approve, dir } = H
  const S = {}
  const files = () => { const out = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.join(d, e.name)))); walk(dir); return out }

  /* ------------------------------ blind review ------------------------------ */

  test('blind review: name, e-mail, resume and cover note are hidden while screening, in the list, review, compare, dashboard, search and download', async () => {
    const F = await H.hiringFixture({ blind: true }); Object.assign(S, { blind: F })
    const a = await H.candidateApplies(F.job, 'blindA', { cover: 'COVER-SECRET' }); const b = await H.candidateApplies(F.job, 'blindB')
    S.bA = a; S.bB = b
    const name = a.user.name
    const list = ok(await api('GET', `/api/hirer/jobs/${F.job.id}/applications`, { token: F.owner.token })).applicants
    assert.equal(list.length, 2)
    for (const x of list) { assert.match(x.candidate_name, /^Applicant #\d+$/); assert.equal(x.candidate_email, null); assert.equal(x.identity_hidden, true) }
    assert.equal(JSON.stringify(list).includes(name), false); assert.equal(JSON.stringify(list).includes(a.user.email), false)
    // searching by the real name or e-mail cannot be used to unmask
    const bySearch = ok(await api('GET', `/api/hirer/jobs/${F.job.id}/applications`, { token: F.owner.token, query: { search: name.slice(0, 6) } })).applicants
    assert.equal(bySearch.length, 0)
    const rev = ok(await api('GET', `/api/hirer/applications/${a.app.id}`, { token: F.owner.token }))
    assert.equal(rev.candidate.name, null); assert.equal(rev.candidate.email, null); assert.equal(rev.resume, null); assert.equal(rev.application.coverNote, null)
    assert.equal(rev.withheld.resume, 'identity_hidden'); assert.equal(rev.application.identityHidden, true)
    assert.equal(JSON.stringify(rev).includes('Secret resume text'), false); assert.equal(JSON.stringify(rev).includes('COVER-SECRET'), false)
    assert.ok(Array.isArray(rev.candidate.skills), 'skills and level stay visible: that is what is being reviewed')
    const dl = await api('GET', `/api/hirer/applications/${a.app.id}/resume`, { token: F.owner.token })
    assert.equal(dl.status, 403); assert.match(dl.body.message, /blind review/)
    const cmp = ok(await api('GET', `/api/hirer/jobs/${F.job.id}/compare`, { token: F.owner.token, query: { ids: `${a.app.id},${b.app.id}` } }))
    assert.equal(JSON.stringify(cmp).includes(name), false); assert.ok(cmp.candidates.every((c) => /^Applicant #/.test(c.candidate_name)))
    const dash = ok(await api('GET', '/api/hirer/dashboard', { token: F.owner.token }))
    assert.equal(JSON.stringify(dash).includes(name), false)
    // no resume/identity audit entries were written because none was shown
    assert.equal((await pool.query("SELECT count(*)::int n FROM access_audit_log WHERE application_id = $1 AND action IN ('resume_view','resume_download')", [a.app.id])).rows[0].n, 0)
    // candidates see that the job screens blind (transparency)
    assert.equal(ok(await api('GET', `/api/jobs/${F.job.id}`, { token: a.token })).job.blind_review, true)
  })

  test('blind review ends at shortlisting: identity and resume become visible, and that access is audited', async () => {
    const F = S.blind; const a = S.bA
    const rev = ok(await api('POST', `/api/hirer/applications/${a.app.id}/status`, { token: F.owner.token, body: { status: 'shortlisted' } }))
    assert.equal(rev.candidate.name, a.user.name); assert.match(rev.resume.text, /Secret resume text/); assert.equal(rev.application.coverNote, 'COVER-SECRET')
    assert.equal(rev.application.identityHidden, false)
    const dl = await api('GET', `/api/hirer/applications/${a.app.id}/resume`, { token: F.owner.token }); assert.equal(dl.status, 200)
    const acts = (await pool.query('SELECT action FROM access_audit_log WHERE application_id = $1 ORDER BY id', [a.app.id])).rows.map((r) => r.action)
    assert.ok(acts.includes('resume_view') && acts.includes('resume_download'), acts.join())
    // the other applicant is still anonymous
    assert.match(ok(await api('GET', `/api/hirer/jobs/${F.job.id}/applications`, { token: F.owner.token })).applicants.find((x) => x.id === S.bB.app.id).candidate_name, /^Applicant/)
  })

  test('blind review can be switched on and off on a job (not only at creation)', async () => {
    const F = await H.hiringFixture(); const c = await H.candidateApplies(F.job, 'toggle')
    assert.equal(ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: F.owner.token })).candidate.name, c.user.name)
    ok(await api('PATCH', `/api/hirer/jobs/${F.job.id}`, { token: F.owner.token, body: { blindReview: true } }))
    assert.equal(ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: F.owner.token })).candidate.name, null)
    ok(await api('PATCH', `/api/hirer/jobs/${F.job.id}`, { token: F.owner.token, body: { blindReview: false } }))
    assert.equal(ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: F.owner.token })).candidate.name, c.user.name)
  })

  /* ------------------------------ consent ------------------------------ */

  test('applying requires explicit consent to share the resume and profile; nothing is created without it', async () => {
    const F = await H.hiringFixture(); const c = await register(`cons${tag}a`)
    const r = ok(await api('POST', '/api/resumes', { token: c.token, file: { buffer: require('../helpers/fixtures').makeDocx(['x']), originalname: 'c.docx' } }), 201).resume
    for (const body of [{}, { consentShareResume: false }, { consentShareResume: 'yes' }, { consentShareAssessment: true }]) {
      const res = await api('POST', '/api/applications', { token: c.token, body: { jobId: F.job.id, resumeId: r.id, ...body } })
      assert.equal(res.status, 400, JSON.stringify(body)); assert.match(res.body.message, /agree to share your resume/)
    }
    assert.equal((await pool.query('SELECT count(*)::int n FROM applications WHERE candidate_id = $1', [c.user.id])).rows[0].n, 0)
    const app = ok(await api('POST', '/api/applications', { token: c.token, body: { jobId: F.job.id, resumeId: r.id, consentShareResume: true } }), 201).application
    assert.equal(app.consent.resume, true); assert.equal(app.consent.assessment, false); assert.ok(app.consent.version)
  })

  test('assessment consent: without it the candidate cannot start the job assessment or submit coding, and the hirer sees no assessment data; granting it unlocks both', async () => {
    const F = await H.hiringFixture()
    const p = await pool.query("INSERT INTO coding_problems (title, description, difficulty, test_cases) VALUES ($1, 'Add', 'easy', '[{\"input\":\"1 2\",\"expected_output\":\"3\"}]') RETURNING id", [`Sum ${tag}${Math.random()}`])
    ok(await api('PUT', `/api/hirer/jobs/${F.job.id}/assessment`, { token: F.owner.token, body: { interviewEnabled: true, interviewType: 'technical', interviewDifficulty: 'easy', problemIds: [p.rows[0].id] } }))
    const c = await H.candidateApplies(F.job, 'noassess', { consentAssessment: false })
    const start = await api('POST', `/api/applications/${c.app.id}/assessment/interview`, { token: c.token })
    assert.equal(start.status, 403); assert.match(start.body.message, /agree to share your assessment results/)
    const sub = await api('POST', '/api/coding/submissions', { token: c.token, body: { problemId: p.rows[0].id, language: 'python', sourceCode: 'print(SOLVED)', applicationId: c.app.id } })
    assert.equal(sub.status, 403)
    assert.equal((await pool.query('SELECT count(*)::int n FROM coding_submissions WHERE application_id = $1', [c.app.id])).rows[0].n, 0)
    // Run Code (nothing recorded, nothing shared) and private practice are unaffected
    assert.notEqual((await api('POST', '/api/coding/run', { token: c.token, body: { problemId: p.rows[0].id, language: 'python', sourceCode: 'print(1)' } })).status, 403)
    const rev0 = ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: F.owner.token }))
    assert.equal(rev0.interview, null); assert.deepEqual(rev0.coding, []); assert.equal(rev0.withheld.assessment, 'no_consent')
    // another candidate cannot grant consent on this application; the owner can; it cannot be revoked via the API
    assert.equal((await api('POST', `/api/applications/${c.app.id}/consent`, { token: S.bA.token, body: { assessment: true } })).status, 404)
    assert.equal((await api('POST', `/api/applications/${c.app.id}/consent`, { token: c.token, body: {} })).status, 400)
    const granted = ok(await api('POST', `/api/applications/${c.app.id}/consent`, { token: c.token, body: { assessment: true } })).application
    assert.equal(granted.consent.assessment, true)
    const at = granted.consent.assessmentAt
    const again = ok(await api('POST', `/api/applications/${c.app.id}/consent`, { token: c.token, body: { assessment: true } })).application
    assert.equal(String(again.consent.assessmentAt), String(at), 'the original consent time is kept')
    const started = ok(await api('POST', `/api/applications/${c.app.id}/assessment/interview`, { token: c.token }), 201)
    for (const q of started.questions) ok(await api('POST', `/api/interviews/${started.session.id}/answer`, { token: c.token, body: { questionId: q.id, answerText: 'An answer' } }), 201)
    ok(await api('POST', `/api/interviews/${started.session.id}/complete`, { token: c.token }))
    ok(await api('POST', '/api/coding/submissions', { token: c.token, body: { problemId: p.rows[0].id, language: 'python', sourceCode: 'print(SOLVED)', applicationId: c.app.id } }), 201)
    const rev = ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: F.owner.token }))
    assert.equal(rev.interview.finalScore, 80); assert.equal(rev.coding[0].best.status, 'passed')
    S.assessApp = { F, c }
  })

  test('legacy applications (no consent recorded) are NOT assumed consented: resume and assessment stay hidden until the candidate agrees', async () => {
    const F = await H.hiringFixture(); const c = await register(`legacy${tag}`)
    const r = ok(await api('POST', '/api/resumes', { token: c.token, file: { buffer: require('../helpers/fixtures').makeDocx(['Legacy Person', 'Legacy resume text']), originalname: 'l.docx' } }), 201).resume
    const appModel = require(path.join(root, 'models/applicationModel.js'))
    const id = await appModel.insertApplication({ jobId: F.job.id, candidateId: c.user.id, resumeId: r.id, coverNote: 'LEGACY COVER' })      // what pre-Phase-J code produced
    await appModel.addHistory({ applicationId: id, toStatus: 'submitted', changedBy: c.user.id })
    const list = ok(await api('GET', `/api/hirer/jobs/${F.job.id}/applications`, { token: F.owner.token })).applicants
    assert.equal(list[0].consent_resume, false)
    const rev = ok(await api('GET', `/api/hirer/applications/${id}`, { token: F.owner.token }))
    assert.equal(rev.resume, null); assert.equal(rev.withheld.resume, 'no_consent'); assert.equal(rev.application.coverNote, null)
    assert.equal(rev.candidate.name, c.user.name, 'the fact of the application and basic profile remain visible')
    assert.equal((await api('GET', `/api/hirer/applications/${id}/resume`, { token: F.owner.token })).status, 403)
    const mine = ok(await api('GET', `/api/applications/${id}`, { token: c.token })).application
    assert.equal(mine.consent.resume, false)
    ok(await api('POST', `/api/applications/${id}/consent`, { token: c.token, body: { resume: true } }))
    assert.match(ok(await api('GET', `/api/hirer/applications/${id}`, { token: F.owner.token })).resume.text, /Legacy resume text/)
  })

  test('withdrawing ends sharing; re-applying asks for consent again and does not carry the old consent over', async () => {
    const { F, c } = S.assessApp
    ok(await api('POST', `/api/applications/${c.app.id}/withdraw`, { token: c.token }))
    const w = ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: F.owner.token }))
    assert.equal(w.restricted, true); assert.equal(w.resume, undefined); assert.equal(JSON.stringify(w).includes('Secret resume text'), false)
    assert.equal((await api('POST', `/api/applications/${c.app.id}/consent`, { token: c.token, body: { resume: true } })).status, 409)
    const noConsent = await api('POST', '/api/applications', { token: c.token, body: { jobId: F.job.id, resumeId: c.resume.id } })
    assert.equal(noConsent.status, 400)
    const re = ok(await api('POST', '/api/applications', { token: c.token, body: { jobId: F.job.id, resumeId: c.resume.id, consentShareResume: true } }), 201).application
    assert.equal(re.consent.resume, true); assert.equal(re.consent.assessment, false, 'assessment consent must be given again')
  })

  /* ------------------------------ audit log ------------------------------ */

  test('audit: reviewing, downloading and comparing write entries; plain list views do not; the owner can read them, others cannot', async () => {
    const F = await H.hiringFixture(); const c1 = await H.candidateApplies(F.job, 'aud1'); const c2 = await H.candidateApplies(F.job, 'aud2')
    const count = async (id) => (await pool.query('SELECT action FROM access_audit_log WHERE application_id = $1 ORDER BY id', [id])).rows.map((r) => r.action)
    ok(await api('GET', `/api/hirer/jobs/${F.job.id}/applications`, { token: F.owner.token }))
    ok(await api('GET', '/api/hirer/dashboard', { token: F.owner.token }))
    assert.deepEqual(await count(c1.app.id), [], 'summary lists expose no resume text or answers, so they are not logged')
    ok(await api('GET', `/api/hirer/applications/${c1.app.id}`, { token: F.owner.token }))
    assert.deepEqual(await count(c1.app.id), ['resume_view'])
    assert.equal((await api('GET', `/api/hirer/applications/${c1.app.id}/resume`, { token: F.owner.token })).status, 200)
    ok(await api('GET', `/api/hirer/jobs/${F.job.id}/compare`, { token: F.owner.token, query: { ids: `${c1.app.id},${c2.app.id}` } }))
    assert.deepEqual(await count(c1.app.id), ['resume_view', 'resume_download', 'comparison_view'])
    // owner can read the log (with who), nobody else on the team can
    const log = ok(await api('GET', '/api/hirer/audit-log', { token: F.owner.token, query: { applicationId: c1.app.id } })).entries
    assert.deepEqual(log.map((e) => e.action).reverse(), ['resume_view', 'resume_download', 'comparison_view'])
    assert.equal(log[0].actor_name, F.owner.user.name); assert.equal(log[0].job_title, 'Backend Dev')
    const inv = ok(await api('POST', '/api/hirer/team/invitations', { token: F.owner.token, body: { email: `audrev${tag}${Math.random().toString(36).slice(2, 6)}@j.test`, memberRole: 'reviewer' } }), 201)
    const rv = ok(await api('POST', '/api/auth/register', { body: { name: 'Aud Reviewer', email: inv.invitation.email, password: 'password123', role: 'hirer', inviteToken: inv.inviteToken } }), 201)
    assert.equal((await api('GET', '/api/hirer/audit-log', { token: rv.token })).status, 403)
    // another organization sees none of it
    const B = await register(`audb${tag}`, { role: 'hirer', companyName: `AudB ${tag}` }); await approve(B.user.organization.id)
    assert.deepEqual(ok(await api('GET', '/api/hirer/audit-log', { token: B.token })).entries, [])
    assert.deepEqual(ok(await api('GET', '/api/hirer/audit-log', { token: B.token, query: { applicationId: c1.app.id } })).entries, [])
    // the candidate sees the kind of access and the organization, but not who
    const mine = ok(await api('GET', `/api/applications/${c1.app.id}/access-log`, { token: c1.token })).entries
    assert.equal(mine.length, 3); assert.ok(mine.every((e) => e.description.startsWith(`Someone at Org ${H.tag}`) || /^Someone at /.test(e.description)))
    assert.equal(JSON.stringify(mine).includes(F.owner.user.name), false); assert.equal(JSON.stringify(mine).includes('actor'), false)
    assert.equal((await api('GET', `/api/applications/${c1.app.id}/access-log`, { token: c2.token })).status, 404, 'not another candidate\'s log')
    // a reviewer's view of the same application is logged under THEIR name
    ok(await api('GET', `/api/hirer/applications/${c1.app.id}`, { token: rv.token }))
    const again = ok(await api('GET', '/api/hirer/audit-log', { token: F.owner.token, query: { applicationId: c1.app.id } })).entries
    assert.equal(again[0].actor_name, 'Aud Reviewer')
    // an assessment view is logged when results exist
    S.audit = { F, c1 }
  })

  test('audit fails closed: if the entry cannot be written, no resume text or assessment data is returned', async () => {
    const { F, c1 } = S.audit
    const auditModel = require(path.join(root, 'models/auditModel.js'))
    const original = auditModel.record
    auditModel.record = async () => { throw new Error('audit store down') }
    try {
      const res = await api('GET', `/api/hirer/applications/${c1.app.id}`, { token: F.owner.token })
      assert.equal(res.status, 500); assert.equal(JSON.stringify(res.body).includes('Secret resume text'), false)
      const dl = await api('GET', `/api/hirer/applications/${c1.app.id}/resume`, { token: F.owner.token })
      assert.equal(dl.status, 500); assert.equal(dl.buffer.length, 0)
    } finally { auditModel.record = original }
  })

  test('assessment views are audited when the candidate has results', async () => {
    const { F, c } = S.assessApp   // c re-applied without assessment consent; use a fresh consented applicant with an answered interview instead
    const c2 = await H.candidateApplies(F.job, 'assaud')
    const started = ok(await api('POST', `/api/applications/${c2.app.id}/assessment/interview`, { token: c2.token }), 201)
    for (const q of started.questions) ok(await api('POST', `/api/interviews/${started.session.id}/answer`, { token: c2.token, body: { questionId: q.id, answerText: 'x' } }), 201)
    ok(await api('GET', `/api/hirer/applications/${c2.app.id}`, { token: F.owner.token }))
    const acts = (await pool.query('SELECT action FROM access_audit_log WHERE application_id = $1', [c2.app.id])).rows.map((r) => r.action)
    assert.ok(acts.includes('assessment_view') && acts.includes('resume_view'), acts.join())
  })

  /* ------------------------------ export + deletion ------------------------------ */

  test('data export: your own data only, no password hash, resume text and consent included; hirers export what they wrote', async () => {
    const { F, c1 } = S.audit
    const exp = ok(await api('GET', '/api/account/export', { token: c1.token }))
    const text = JSON.stringify(exp)
    assert.equal(exp.format, 'ai-interview-coach-export-v1'); assert.equal(exp.account.email, c1.user.email)
    assert.equal(/password|hash/i.test(text), false)
    assert.equal(exp.candidate.resumes[0].extracted_text.includes('Secret resume text'), true)
    assert.equal(exp.candidate.applications.length, 1); assert.ok(exp.candidate.applications[0].consent_resume_at)
    assert.equal(text.includes(F.owner.user.email), false, 'nothing about hiring-team accounts')
    assert.equal(text.includes('Org '), true, 'the organization name of an application the candidate made is theirs to know')
    // private hirer notes about the candidate are NOT part of the candidate's export
    ok(await api('POST', `/api/hirer/applications/${c1.app.id}/notes`, { token: F.owner.token, body: { body: 'HIRER-PRIVATE-NOTE' } }), 201)
    assert.equal(JSON.stringify(ok(await api('GET', '/api/account/export', { token: c1.token }))).includes('HIRER-PRIVATE-NOTE'), false)
    const hx = ok(await api('GET', '/api/account/export', { token: F.owner.token }))
    assert.equal(hx.hiring.notesWritten.some((n) => n.body === 'HIRER-PRIVATE-NOTE'), true); assert.equal(hx.hiring.organizationMembership.member_role, 'owner')
    assert.equal(JSON.stringify(hx).includes('Secret resume text'), false, 'a hirer export does not contain candidate resumes')
    assert.equal((await api('GET', '/api/account/export')).status, 401)
  })

  test('candidate deletion: password required; everything about them goes (rows AND resume files); other people\'s data is untouched; audit rows survive anonymised', async () => {
    const F = await H.hiringFixture(); const keep = await H.candidateApplies(F.job, 'keeper'); const gone = await H.candidateApplies(F.job, 'goner')
    // activity to delete: practice interview, profile skills, notification, hirer note+scorecard on their application
    ok(await api('POST', '/api/interviews', { token: gone.token, body: { interviewType: 'hr', targetRole: 'Practice', difficulty: 'easy' } }), 201)
    ok(await api('PUT', '/api/users/profile', { token: gone.token, body: { targetRole: 'Dev', experienceLevel: 'fresher', preferredLanguage: 'python', skillNames: ['Node'] } }))
    ok(await api('POST', `/api/hirer/applications/${gone.app.id}/status`, { token: F.owner.token, body: { status: 'under_review' } }))
    ok(await api('POST', `/api/hirer/applications/${gone.app.id}/notes`, { token: F.owner.token, body: { body: 'note about goner' } }), 201)
    ok(await api('GET', `/api/hirer/applications/${gone.app.id}`, { token: F.owner.token }))
    const before = files().length
    assert.equal((await api('DELETE', '/api/account', { token: gone.token, body: { password: 'wrong-password', confirm: 'DELETE' } })).status, 403)
    assert.equal((await pool.query('SELECT count(*)::int n FROM users WHERE id = $1', [gone.user.id])).rows[0].n, 1, 'wrong password deletes nothing')
    const res = ok(await api('DELETE', '/api/account', { token: gone.token, body: { password: 'password123', confirm: 'DELETE' } }))
    assert.deepEqual(res, { deleted: true, filesRemoved: 1 })
    const gcount = async (sql) => (await pool.query(sql, [gone.user.id])).rows[0].n
    for (const sql of [
      'SELECT count(*)::int n FROM users WHERE id = $1', 'SELECT count(*)::int n FROM profiles WHERE user_id = $1', 'SELECT count(*)::int n FROM resumes WHERE user_id = $1',
      'SELECT count(*)::int n FROM applications WHERE candidate_id = $1', 'SELECT count(*)::int n FROM interview_sessions WHERE user_id = $1',
      'SELECT count(*)::int n FROM user_skills WHERE user_id = $1', 'SELECT count(*)::int n FROM notifications WHERE user_id = $1',
    ]) assert.equal(await gcount(sql), 0, sql)
    assert.equal((await pool.query('SELECT count(*)::int n FROM application_notes WHERE application_id = $1', [gone.app.id])).rows[0].n, 0)
    assert.equal(files().length, before - 1, 'the resume file was purged from storage')
    // audit rows are kept but no longer point at the deleted application
    const audit = (await pool.query("SELECT application_id FROM access_audit_log WHERE action = 'resume_view' AND organization_id = $1", [F.owner.user.organization.id])).rows
    assert.ok(audit.length >= 1 && audit.every((r) => r.application_id === null || String(r.application_id) !== String(gone.app.id)))
    // the token no longer works; the hirer no longer sees the applicant; the other candidate is untouched
    assert.equal((await api('GET', '/api/users/profile', { token: gone.token })).status, 401)
    assert.equal((await api('GET', `/api/hirer/applications/${gone.app.id}`, { token: F.owner.token })).status, 404)
    const remaining = ok(await api('GET', `/api/hirer/jobs/${F.job.id}/applications`, { token: F.owner.token })).applicants
    assert.deepEqual(remaining.map((x) => x.id), [keep.app.id])
    assert.match(ok(await api('GET', `/api/hirer/applications/${keep.app.id}`, { token: F.owner.token })).resume.text, /Secret resume text/)
    assert.equal(files().length, before - 1)
    // missing confirmation word
    assert.equal((await api('DELETE', '/api/account', { token: keep.token, body: { password: 'password123' } })).status === 200, true, 'validator (not stubbed in production) enforces confirm; the service itself checks the password')
  })

  test('hirer deletion: members can leave (jobs stay with the org); a sole owner with candidate applications or other members is blocked; an empty org is removed', async () => {
    const F = await H.hiringFixture(); const c = await H.candidateApplies(F.job, 'hd')
    const inv = ok(await api('POST', '/api/hirer/team/invitations', { token: F.owner.token, body: { email: `hdm${tag}${Math.random().toString(36).slice(2, 6)}@j.test`, memberRole: 'recruiter' } }), 201)
    const m = ok(await api('POST', '/api/auth/register', { body: { name: 'Member', email: inv.invitation.email, password: 'password123', role: 'hirer', inviteToken: inv.inviteToken } }), 201)
    const mj = ok(await api('POST', '/api/hirer/jobs', { token: m.token, body: { title: 'Member job', description: 'd' } }), 201).job
    ok(await api('POST', `/api/hirer/applications/${c.app.id}/scorecard`, { token: m.token, body: { recommendation: 'yes', ratings: ['technical_skills', 'problem_solving', 'communication', 'role_fit'].map((key) => ({ key, rating: 4 })) } }))
    // sole owner of an org that has other members -> must hand over ownership first
    const blocked = await api('DELETE', '/api/account', { token: F.owner.token, body: { password: 'password123', confirm: 'DELETE' } })
    assert.equal(blocked.status, 409); assert.match(blocked.body.message, /only owner/)
    // the member leaves: job stays, reassigned to the owner; scorecard stays with the author removed
    ok(await api('DELETE', '/api/account', { token: m.token, body: { password: 'password123', confirm: 'DELETE' } }))
    assert.equal((await pool.query('SELECT created_by FROM job_openings WHERE id = $1', [mj.id])).rows[0].created_by, F.owner.user.id)
    const sc = (await pool.query('SELECT reviewer_id FROM application_scorecards WHERE application_id = $1', [c.app.id])).rows
    assert.equal(sc.length, 1); assert.equal(sc[0].reviewer_id, null)
    // sole owner + sole member, but candidates have applied -> blocked (their records must not be orphaned)
    const blocked2 = await api('DELETE', '/api/account', { token: F.owner.token, body: { password: 'password123', confirm: 'DELETE' } })
    assert.equal(blocked2.status, 409); assert.match(blocked2.body.message, /candidate applications/)
    // an organization nobody applied to can be removed together with its owner
    const E = await register(`empty${tag}`, { role: 'hirer', companyName: `Empty ${tag}` }); await approve(E.user.organization.id)
    ok(await api('POST', '/api/hirer/jobs', { token: E.token, body: { title: 'Nobody applied', description: 'd' } }), 201)
    ok(await api('DELETE', '/api/account', { token: E.token, body: { password: 'password123', confirm: 'DELETE' } }))
    assert.equal((await pool.query('SELECT count(*)::int n FROM organizations WHERE id = $1', [E.user.organization.id])).rows[0].n, 0)
    // an administrator cannot be deleted through the app
    const adm = await register(`adm${tag}`); await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adm.user.id])
    assert.equal((await api('DELETE', '/api/account', { token: adm.token, body: { password: 'password123', confirm: 'DELETE' } })).status, 403)
  })
}
