// Phase J: hiring teams (invitations, org-scoped permissions), structured scorecards, blind review, required
// rejection reasons, candidate notifications. Real route chains + real PostgreSQL.
const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./harness')

if (!process.env.AIC_TEST_DB) { test('Phase J team/review', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('team')
  const { api, ok, pool, register, tag, approve } = H
  const S = {}

  test('setup: org A (owner), a job, two candidates who applied', async () => {
    Object.assign(S, await H.hiringFixture())
    S.c1 = await H.candidateApplies(S.job, 'cand1')
    S.c2 = await H.candidateApplies(S.job, 'cand2')
  })

  test('invitations: owner only; token shown once, stored hashed; single use; email must match; expiry and revoke work', async () => {
    const inv = ok(await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `Rec.Ruiter${tag}+x@Gmail.com`, memberRole: 'recruiter' } }), 201)
    assert.match(inv.inviteToken, /^[0-9a-f]{64}$/)
    const stored = (await pool.query('SELECT token_hash, email FROM organization_invitations WHERE id = $1', [inv.invitation.id])).rows[0]
    assert.notEqual(stored.token_hash, inv.inviteToken); assert.equal(stored.token_hash.length, 64)
    assert.equal(stored.email, `recruiter${tag}@gmail.com`, 'stored in the same canonical form registration produces')
    const listed = ok(await api('GET', '/api/hirer/team', { token: S.owner.token }))
    assert.equal(JSON.stringify(listed).includes(inv.inviteToken), false, 'the token is never listed again')
    assert.equal(listed.invitations.length, 1)
    // duplicate live invitation, existing account, bad role
    assert.equal((await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `recruiter${tag}@gmail.com`, memberRole: 'reviewer' } })).status, 409)
    assert.equal((await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: S.c1.user.email, memberRole: 'reviewer' } })).status, 409)
    assert.equal((await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `x${tag}@j.test`, memberRole: 'owner' } })).status, 400)
    // wrong e-mail / garbage token / candidate role cannot use it
    const reg = (body) => api('POST', '/api/auth/register', { body: { name: 'Rec', password: 'password123', role: 'hirer', ...body } })
    assert.equal((await reg({ email: `someoneelse${tag}@j.test`, inviteToken: inv.inviteToken })).status, 400)
    assert.equal((await reg({ email: `recruiter${tag}@gmail.com`, inviteToken: 'f'.repeat(64) })).status, 400)
    assert.equal((await api('POST', '/api/auth/register', { body: { name: 'C', email: `recruiter${tag}@gmail.com`, password: 'password123', inviteToken: inv.inviteToken } })).status, 400, 'candidates cannot accept')
    // success: joins the EXISTING organization, with the invited role, no new organization
    const orgCount = (await pool.query('SELECT count(*)::int n FROM organizations')).rows[0].n
    const joined = ok(await reg({ email: `recruiter${tag}@gmail.com`, inviteToken: inv.inviteToken }), 201)
    assert.equal(joined.user.organization.id, S.owner.user.organization.id); assert.equal(joined.user.organization.memberRole, 'recruiter')
    assert.equal((await pool.query('SELECT count(*)::int n FROM organizations')).rows[0].n, orgCount)
    S.recruiter = joined
    // single use
    assert.equal((await reg({ email: `recruiter${tag}@gmail.com`, inviteToken: inv.inviteToken })).status, 409, 'account now exists')
    const again = (await pool.query('SELECT accepted_at FROM organization_invitations WHERE id = $1', [inv.invitation.id])).rows[0]
    assert.ok(again.accepted_at)
    // revoked and expired invitations are refused with the same generic message
    const inv2 = ok(await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `rev${tag}@j.test`, memberRole: 'reviewer' } }), 201)
    ok(await api('DELETE', `/api/hirer/team/invitations/${inv2.invitation.id}`, { token: S.owner.token }))
    const r1 = await reg({ email: `rev${tag}@j.test`, inviteToken: inv2.inviteToken }); assert.equal(r1.status, 400); assert.match(r1.body.message, /invalid, expired or already used/)
    const inv3 = ok(await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `exp${tag}@j.test`, memberRole: 'reviewer' } }), 201)
    await pool.query("UPDATE organization_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [inv3.invitation.id])
    const r2 = await reg({ email: `exp${tag}@j.test`, inviteToken: inv3.inviteToken }); assert.equal(r2.status, 400); assert.equal(r2.body.message, r1.body.message)
    // a fresh reviewer
    const inv4 = ok(await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `reviewer${tag}@j.test`, memberRole: 'reviewer' } }), 201)
    S.reviewer = ok(await reg({ email: `reviewer${tag}@j.test`, inviteToken: inv4.inviteToken }), 201)
    assert.equal(S.reviewer.user.organization.memberRole, 'reviewer')
  })

  test('permission matrix: reviewer = read + notes + scorecards only; recruiter = jobs + decisions but no team/audit; owner = all', async () => {
    const A = S.c1.app.id
    // team management
    for (const who of [S.recruiter, S.reviewer]) {
      assert.equal((await api('POST', '/api/hirer/team/invitations', { token: who.token, body: { email: `n${tag}@j.test`, memberRole: 'reviewer' } })).status, 403)
      assert.equal((await api('PATCH', `/api/hirer/team/members/${S.reviewer.user.id}`, { token: who.token, body: { memberRole: 'owner' } })).status, 403)
      assert.equal((await api('DELETE', `/api/hirer/team/members/${S.owner.user.id}`, { token: who.token })).status, 403)
      assert.equal((await api('GET', '/api/hirer/audit-log', { token: who.token })).status, 403)
      ok(await api('GET', '/api/hirer/team', { token: who.token }))                                       // everyone can see the team
    }
    // jobs
    assert.equal((await api('POST', '/api/hirer/jobs', { token: S.reviewer.token, body: { title: 'x', description: 'y' } })).status, 403)
    assert.equal((await api('PATCH', `/api/hirer/jobs/${S.job.id}`, { token: S.reviewer.token, body: { title: 'hacked' } })).status, 403)
    assert.equal((await api('POST', `/api/hirer/jobs/${S.job.id}/status`, { token: S.reviewer.token, body: { status: 'closed' } })).status, 403)
    assert.equal((await api('PUT', `/api/hirer/jobs/${S.job.id}/assessment`, { token: S.reviewer.token, body: { interviewEnabled: false, problemIds: [] } })).status, 403)
    ok(await api('GET', `/api/hirer/jobs/${S.job.id}`, { token: S.reviewer.token }))
    ok(await api('PATCH', `/api/hirer/jobs/${S.job.id}`, { token: S.recruiter.token, body: { location: 'Remote' } }))
    // decisions
    assert.equal((await api('POST', `/api/hirer/applications/${A}/status`, { token: S.reviewer.token, body: { status: 'shortlisted' } })).status, 403)
    // review actions are open to reviewers
    ok(await api('POST', `/api/hirer/applications/${A}/notes`, { token: S.reviewer.token, body: { body: 'Looks promising' } }), 201)
    ok(await api('GET', `/api/hirer/applications/${A}`, { token: S.reviewer.token }))
    ok(await api('GET', `/api/hirer/jobs/${S.job.id}/applications`, { token: S.reviewer.token }))
    // status unchanged after the refused attempts
    assert.equal((await pool.query('SELECT status FROM applications WHERE id = $1', [A])).rows[0].status, 'submitted')
  })

  test('role changes take effect immediately (role is re-read from the database, not the token); owner safeguards', async () => {
    const before = await api('POST', `/api/hirer/applications/${S.c2.app.id}/status`, { token: S.recruiter.token, body: { status: 'under_review' } })
    assert.equal(before.status, 200)
    ok(await api('PATCH', `/api/hirer/team/members/${S.recruiter.user.id}`, { token: S.owner.token, body: { memberRole: 'reviewer' } }))
    assert.equal((await api('POST', `/api/hirer/applications/${S.c2.app.id}/status`, { token: S.recruiter.token, body: { status: 'shortlisted' } })).status, 403, 'same token, demoted')
    ok(await api('PATCH', `/api/hirer/team/members/${S.recruiter.user.id}`, { token: S.owner.token, body: { memberRole: 'recruiter' } }))
    assert.equal((await api('PATCH', `/api/hirer/team/members/${S.owner.user.id}`, { token: S.owner.token, body: { memberRole: 'reviewer' } })).status, 409, 'cannot demote yourself')
    assert.equal((await api('DELETE', `/api/hirer/team/members/${S.owner.user.id}`, { token: S.owner.token })).status, 409, 'cannot remove yourself')
    assert.equal((await api('PATCH', `/api/hirer/team/members/99999999`, { token: S.owner.token, body: { memberRole: 'reviewer' } })).status, 404)
  })

  test('cross-organization isolation: another org cannot see, change or invite into this team; team ids from other orgs are 404', async () => {
    const B = await register('orgb', { role: 'hirer', companyName: `Rival ${tag}` }); await approve(B.user.organization.id)
    const teamB = ok(await api('GET', '/api/hirer/team', { token: B.token }))
    assert.deepEqual(teamB.members.map((m) => m.user_id), [B.user.id]); assert.deepEqual(teamB.invitations, [])
    assert.equal((await api('PATCH', `/api/hirer/team/members/${S.reviewer.user.id}`, { token: B.token, body: { memberRole: 'owner' } })).status, 404)
    assert.equal((await api('DELETE', `/api/hirer/team/members/${S.reviewer.user.id}`, { token: B.token })).status, 404)
    const inv = ok(await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `iso${tag}@j.test`, memberRole: 'reviewer' } }), 201)
    assert.equal((await api('DELETE', `/api/hirer/team/invitations/${inv.invitation.id}`, { token: B.token })).status, 404)
    assert.equal((await api('POST', `/api/hirer/applications/${S.c1.app.id}/scorecard`, { token: B.token, body: { recommendation: 'yes', ratings: [] } })).status, 404)
    ok(await api('DELETE', `/api/hirer/team/invitations/${inv.invitation.id}`, { token: S.owner.token }))
    // a pending organization's invitees are also gated by that org's approval
    S.orgB = B
  })

  test('removing a member: loses access at once; their jobs stay with the organization; notes stay', async () => {
    const extra = ok(await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `temp${tag}@j.test`, memberRole: 'recruiter' } }), 201)
    const temp = ok(await api('POST', '/api/auth/register', { body: { name: 'Temp', email: `temp${tag}@j.test`, password: 'password123', role: 'hirer', inviteToken: extra.inviteToken } }), 201)
    const tj = ok(await api('POST', '/api/hirer/jobs', { token: temp.token, body: { title: 'Temp job', description: 'd' } }), 201).job
    ok(await api('POST', `/api/hirer/applications/${S.c1.app.id}/notes`, { token: temp.token, body: { body: `temp note ${tag}` } }), 201)
    const team = ok(await api('DELETE', `/api/hirer/team/members/${temp.user.id}`, { token: S.owner.token }))
    assert.equal(team.members.some((m) => String(m.user_id) === String(temp.user.id)), false)
    assert.equal((await api('GET', '/api/hirer/jobs', { token: temp.token })).status, 403, 'no organization any more')
    assert.equal((await pool.query('SELECT created_by FROM job_openings WHERE id = $1', [tj.id])).rows[0].created_by, S.owner.user.id)
    assert.equal((await pool.query("SELECT count(*)::int n FROM application_notes WHERE body = 'temp note ' || $1", [tag])).rows[0].n, 1)
  })

  /* ------------------------------ scorecards ------------------------------ */

  test('scorecards: every criterion must be rated 1-5; unknown criteria rejected; resubmitting edits instead of duplicating', async () => {
    const A = S.c1.app.id
    const rev = ok(await api('GET', `/api/hirer/applications/${A}`, { token: S.reviewer.token }))
    const keys = rev.scorecards.criteria.map((c) => c.key)
    assert.deepEqual(keys, ['technical_skills', 'problem_solving', 'communication', 'role_fit'], 'platform defaults')
    const full = (n) => keys.map((k) => ({ key: k, rating: n, comment: k === 'communication' ? 'clear' : null }))
    const post = (token, body) => api('POST', `/api/hirer/applications/${A}/scorecard`, { token, body })
    assert.equal((await post(S.reviewer.token, { recommendation: 'yes', ratings: full(4).slice(0, 3) })).status, 400, 'missing criterion')
    assert.equal((await post(S.reviewer.token, { recommendation: 'yes', ratings: full(6) })).status, 400, 'out of range')
    assert.equal((await post(S.reviewer.token, { recommendation: 'maybe', ratings: full(3) })).status, 400)
    assert.equal((await post(S.reviewer.token, { recommendation: 'yes', ratings: [...full(3), { key: 'charm', rating: 5 }] })).status, 400)
    assert.equal((await post(S.reviewer.token, { recommendation: 'yes', ratings: [...full(3), { key: 'role_fit', rating: 2 }] })).status, 400, 'duplicate')
    const first = ok(await post(S.reviewer.token, { recommendation: 'yes', summary: 'Solid basics', ratings: full(4) }))
    assert.equal(first.scorecards.mine.recommendation, 'yes'); assert.equal(first.scorecards.mine.ratings.length, 4)
    const edited = ok(await post(S.reviewer.token, { recommendation: 'strong_yes', ratings: full(5) }))
    assert.equal(edited.scorecards.mine.recommendation, 'strong_yes')
    assert.equal((await pool.query('SELECT count(*)::int n FROM application_scorecards WHERE application_id = $1', [A])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int n FROM application_scorecard_ratings r JOIN application_scorecards s ON s.id = r.scorecard_id WHERE s.application_id = $1', [A])).rows[0].n, 4)
  })

  test('independent scoring: colleagues\' scorecards stay hidden until you submit yours (or screening is finished); only a count is shown', async () => {
    const A = S.c1.app.id
    const view = async (who) => ok(await api('GET', `/api/hirer/applications/${A}`, { token: who.token })).scorecards
    const forOwner = await view(S.owner)
    assert.equal(forOwner.mine, null); assert.deepEqual(forOwner.others, []); assert.equal(forOwner.othersCount, 1); assert.equal(forOwner.othersHidden, true)
    assert.equal(JSON.stringify(forOwner).includes('strong_yes'), false, 'nothing about the other scorecard leaks')
    const keys = forOwner.criteria.map((c) => c.key)
    ok(await api('POST', `/api/hirer/applications/${A}/scorecard`, { token: S.owner.token, body: { recommendation: 'no', ratings: keys.map((k) => ({ key: k, rating: 2 })) } }))
    const after = await view(S.owner)
    assert.equal(after.others.length, 1); assert.equal(after.others[0].recommendation, 'strong_yes'); assert.equal(after.othersHidden, false)
    // a third member who has not scored still cannot see them while the application is in screening
    const hidden = await view(S.recruiter); assert.deepEqual(hidden.others, []); assert.equal(hidden.othersCount, 2)
    // ... but once the application has been shortlisted the team's scorecards are open to all
    ok(await api('POST', `/api/hirer/applications/${A}/status`, { token: S.owner.token, body: { status: 'shortlisted' } }))
    assert.equal((await view(S.recruiter)).others.length, 2)
    // nothing computes a decision: no aggregate / auto outcome fields exist
    assert.equal(/average|overall|autoDecision|ranking/i.test(JSON.stringify(await view(S.owner))), false)
  })

  test('custom per-job criteria replace the defaults; the job update validates them', async () => {
    const F = await H.hiringFixture({ criteria: ['System design', 'Ownership', 'System design'] }).catch((e) => e)
    // duplicate names are rejected by the API (400 from job creation), so the fixture throws
    assert.ok(F instanceof Error || F.job === undefined)
    const G = await H.hiringFixture({ criteria: ['System design', 'Ownership'] })
    const c = await H.candidateApplies(G.job, 'custom')
    const sc = ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: G.owner.token })).scorecards
    assert.deepEqual(sc.criteria.map((x) => x.label), ['System design', 'Ownership'])
    assert.equal((await api('POST', `/api/hirer/applications/${c.app.id}/scorecard`, { token: G.owner.token, body: { recommendation: 'yes', ratings: [{ key: 'technical_skills', rating: 3 }] } })).status, 400)
    ok(await api('POST', `/api/hirer/applications/${c.app.id}/scorecard`, { token: G.owner.token, body: { recommendation: 'yes', ratings: [{ key: 'system_design', rating: 3 }, { key: 'ownership', rating: 4 }] } }))
    const upd = ok(await api('PATCH', `/api/hirer/jobs/${G.job.id}`, { token: G.owner.token, body: { scorecardCriteria: null } })).job
    assert.equal(upd.scorecard_criteria, null, 'null returns to the defaults')
    // candidates never see scorecard criteria or the hirer's job internals
    const seen = ok(await api('GET', `/api/jobs/${G.job.id}`, { token: c.token })).job
    assert.equal('scorecard_criteria' in seen, false)
  })

  /* ------------------------------ rejection ------------------------------ */

  test('rejecting requires a structured reason; "other" requires an explanation; the candidate sees the neutral label, never the private note', async () => {
    const A = S.c2.app.id
    const post = (body, token = S.owner.token) => api('POST', `/api/hirer/applications/${A}/status`, { token, body })
    assert.equal((await post({ status: 'rejected' })).status, 400)
    assert.equal((await post({ status: 'rejected', reasonCode: 'because' })).status, 400)
    assert.equal((await post({ status: 'rejected', reasonCode: 'other' })).status, 400)
    assert.equal((await post({ status: 'rejected', reasonCode: 'other', note: 'short' })).status, 400)
    assert.notEqual((await pool.query('SELECT status FROM applications WHERE id = $1', [A])).rows[0].status, 'rejected')
    const done = ok(await post({ status: 'rejected', reasonCode: 'skills_mismatch', note: 'PRIVATE: weak on SQL joins' }))
    const last = done.history[done.history.length - 1]
    assert.equal(last.reason_code, 'skills_mismatch'); assert.equal(last.note, 'PRIVATE: weak on SQL joins')
    const mine = ok(await api('GET', `/api/applications/${A}`, { token: S.c2.token })).application
    const h = mine.history[mine.history.length - 1]
    assert.equal(h.to_status, 'rejected'); assert.match(h.reason, /required skills did not match/i)
    assert.equal(JSON.stringify(mine).includes('PRIVATE'), false, 'free-text notes never reach the candidate')
    // reconsidering needs no reason; non-reject transitions ignore a stray reason code
    ok(await post({ status: 'under_review', reasonCode: 'skills_mismatch' }))
    const hist = (await pool.query('SELECT to_status, reason_code FROM application_status_history WHERE application_id = $1 ORDER BY id DESC LIMIT 1', [A])).rows[0]
    assert.equal(hist.to_status, 'under_review'); assert.equal(hist.reason_code, null)
  })

  test('notifications: created with each status change, in the same transaction; private to the candidate; read/unread works', async () => {
    const A = S.c2.app.id
    const list = ok(await api('GET', '/api/notifications', { token: S.c2.token }))
    const titles = list.notifications.map((n) => n.title)
    assert.ok(titles.some((t) => /under review/i.test(t)) && titles.some((t) => /Update on your application/.test(t)), titles.join(' | '))
    const rejected = list.notifications.find((n) => /Update on your application/.test(n.title))
    assert.match(rejected.body, /required skills did not match/i); assert.equal(rejected.body.includes('PRIVATE'), false)
    assert.equal(list.unreadCount, list.notifications.length)
    assert.equal(ok(await api('GET', '/api/notifications/unread-count', { token: S.c2.token })).unreadCount, list.unreadCount)
    assert.equal(ok(await api('GET', '/api/notifications', { token: S.c1.token })).notifications.some((n) => n.application_id === A || String(n.application_id) === String(A)), false, 'other candidates see none of it')
    assert.equal((await api('POST', `/api/notifications/${rejected.id}/read`, { token: S.c1.token })).status, 404, 'cannot mark someone else\'s notification')
    const r = ok(await api('POST', `/api/notifications/${rejected.id}/read`, { token: S.c2.token }))
    assert.equal(r.unreadCount, list.unreadCount - 1)
    assert.equal(ok(await api('GET', '/api/notifications', { token: S.c2.token, query: { unread: 'true' } })).notifications.some((n) => n.id === rejected.id), false)
    assert.equal(ok(await api('POST', '/api/notifications/read-all', { token: S.c2.token })).unreadCount, 0)
    // a failed status change (conflict) creates no notification
    const n0 = (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1', [S.c2.user.id])).rows[0].n
    assert.equal((await api('POST', `/api/hirer/applications/${A}/status`, { token: S.owner.token, body: { status: 'under_review' } })).status, 409)
    assert.equal((await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1', [S.c2.user.id])).rows[0].n, n0)
    // hirers have no candidate notifications, and anonymous access is refused
    assert.equal(ok(await api('GET', '/api/notifications', { token: S.owner.token })).notifications.length, 0)
    assert.equal((await api('GET', '/api/notifications')).status, 401)
  })
}
