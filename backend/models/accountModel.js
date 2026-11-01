const { pool } = require('../config/db')

/**
 * Data export and account deletion queries (Phase J). Everything is keyed by the caller's own user id, which comes
 * from the verified token, never from the request.
 */

const q = async (text, params, client = pool) => (await client.query(text, params)).rows

async function exportCandidate(userId) {
  const [profile, skills, resumes, sessions, answers, submissions, hints, applications, history, notifications, scores, goals, faceSessions] = await Promise.all([
    q('SELECT target_role, experience_level, preferred_language, updated_at FROM profiles WHERE user_id = $1', [userId]),
    q('SELECT s.name FROM user_skills us JOIN skills s ON s.id = us.skill_id WHERE us.user_id = $1 ORDER BY s.name', [userId]),
    q('SELECT id, original_filename, content_type, size_bytes, extraction_status, extracted_text, created_at FROM resumes WHERE user_id = $1 ORDER BY id', [userId]),
    q(`SELECT s.id, s.interview_type, s.target_role, s.difficulty, s.status, s.final_score, s.started_at, s.completed_at, s.application_id,
              (SELECT json_agg(json_build_object('order', qn.order_index, 'question', qn.question_text, 'topic', t.name) ORDER BY qn.order_index)
                 FROM interview_questions qn LEFT JOIN topics t ON t.id = qn.topic_id WHERE qn.session_id = s.id) AS questions
         FROM interview_sessions s WHERE s.user_id = $1 ORDER BY s.id`, [userId]),
    q(`SELECT qn.session_id, qn.order_index, ia.answer_text, ia.audio_transcript, ia.technical_score, ia.relevance_score, ia.clarity_score, ia.completeness_score,
              ia.strengths, ia.weaknesses, ia.suggested_improvement, ia.model_answer, ia.speech_metrics, ia.cv_metrics, ia.evaluation_meta, ia.typing_metrics, ia.created_at
         FROM interview_answers ia JOIN interview_questions qn ON qn.id = ia.question_id JOIN interview_sessions s ON s.id = qn.session_id
        WHERE s.user_id = $1 ORDER BY qn.session_id, qn.order_index`, [userId]),
    q(`SELECT cs.id, cp.title AS problem, cs.language, cs.source_code, cs.status, cs.test_cases_passed, cs.test_cases_total, cs.execution_time_ms, cs.submitted_at, cs.application_id
         FROM coding_submissions cs JOIN coding_problems cp ON cp.id = cs.problem_id WHERE cs.user_id = $1 ORDER BY cs.id`, [userId]),
    q('SELECT cp.title AS problem, h.level, h.revealed_at FROM coding_hint_reveals h JOIN coding_problems cp ON cp.id = h.problem_id WHERE h.user_id = $1 ORDER BY h.revealed_at', [userId]),
    q(`SELECT a.id, j.title AS job_title, o.name AS organization, a.status, a.cover_note, a.created_at, a.consent_resume_at, a.consent_assessment_at, a.consent_version, r.original_filename AS resume
         FROM applications a JOIN job_openings j ON j.id = a.job_id JOIN organizations o ON o.id = j.organization_id JOIN resumes r ON r.id = a.resume_id
        WHERE a.candidate_id = $1 ORDER BY a.id`, [userId]),
    q(`SELECT h.application_id, h.from_status, h.to_status, h.reason_code, h.created_at
         FROM application_status_history h JOIN applications a ON a.id = h.application_id WHERE a.candidate_id = $1 ORDER BY h.id`, [userId]),
    q('SELECT type, title, body, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY id', [userId]),
    q('SELECT session_id, technical_interview_score, coding_score, communication_score, overall_score, calculated_at FROM performance_scores WHERE user_id = $1 ORDER BY id', [userId]),
    q('SELECT weekly_interviews, weekly_problems, updated_at FROM user_goals WHERE user_id = $1', [userId]),
    // Optional face monitoring (consent-based, practice only). Measurements and events only; no images or templates exist.
    q(`SELECT s.id, s.interview_session_id, s.status, s.consent_version, s.consented_at, s.identity_consent, s.started_at, s.ended_at, s.report,
              (SELECT json_agg(json_build_object('type', e.event_type, 'category', e.category, 'status', e.status, 'startedAt', e.started_at, 'endedAt', e.ended_at, 'durationMs', e.duration_ms, 'explanation', e.explanation) ORDER BY e.started_at, e.id)
                 FROM face_monitoring_events e WHERE e.session_id = s.id) AS events
         FROM face_monitoring_sessions s WHERE s.user_id = $1 ORDER BY s.id`, [userId]),
  ])
  return { profile: profile[0] || null, skills: skills.map((s) => s.name), resumes, interviewSessions: sessions, interviewAnswers: answers, codingSubmissions: submissions, hintReveals: hints, applications, applicationHistory: history, notifications, performanceScores: scores, weeklyGoals: goals[0] || null, faceMonitoringSessions: faceSessions }
}

async function exportHirer(userId) {
  const [membership, notes, scorecards, invitations] = await Promise.all([
    q(`SELECT o.name AS organization, o.status, m.member_role, m.created_at AS joined_at FROM organization_members m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = $1`, [userId]),
    q(`SELECT n.application_id, j.title AS job_title, n.body, n.created_at FROM application_notes n JOIN applications a ON a.id = n.application_id JOIN job_openings j ON j.id = a.job_id WHERE n.author_id = $1 ORDER BY n.id`, [userId]),
    q(`SELECT s.application_id, s.recommendation, s.summary, s.updated_at,
              (SELECT json_agg(json_build_object('criterion', r.criterion_label, 'rating', r.rating, 'comment', r.comment) ORDER BY r.criterion_key)
                 FROM application_scorecard_ratings r WHERE r.scorecard_id = s.id) AS ratings
         FROM application_scorecards s WHERE s.reviewer_id = $1 ORDER BY s.id`, [userId]),
    q('SELECT email, member_role, created_at, accepted_at, revoked_at FROM organization_invitations WHERE invited_by = $1 ORDER BY id', [userId]),
  ])
  return { organizationMembership: membership[0] || null, notesWritten: notes, scorecardsWritten: scorecards, invitationsSent: invitations }
}

/* ------------------------------- deletion ------------------------------- */

const resumeKeys = async (userId, client) => (await q('SELECT storage_key FROM resumes WHERE user_id = $1', [userId], client)).map((r) => r.storage_key)

/** Candidate: removes applications first (they hold RESTRICT references to resumes), then the user (cascades the rest). */
async function deleteCandidate(userId, client) {
  const keys = await resumeKeys(userId, client)
  await client.query('DELETE FROM applications WHERE candidate_id = $1', [userId])
  await client.query('DELETE FROM users WHERE id = $1', [userId])
  return keys
}

async function getMembership(userId, client) {
  return (await q('SELECT organization_id, member_role FROM organization_members WHERE user_id = $1', [userId], client))[0] || null
}
async function otherOwners(organizationId, userId, client) {
  return q("SELECT user_id FROM organization_members WHERE organization_id = $1 AND member_role = 'owner' AND user_id <> $2 ORDER BY created_at, user_id", [organizationId, userId], client)
}
async function memberCount(organizationId, client) {
  return (await q('SELECT count(*)::int AS n FROM organization_members WHERE organization_id = $1', [organizationId], client))[0].n
}
async function organizationApplicationCount(organizationId, client) {
  return (await q('SELECT count(*)::int AS n FROM applications a JOIN job_openings j ON j.id = a.job_id WHERE j.organization_id = $1', [organizationId], client))[0].n
}
/** Jobs and the organization record keep existing; their "created by" pointer moves to another owner. */
async function reassignCreator({ organizationId, fromUserId, toUserId }, client) {
  await client.query('UPDATE job_openings SET created_by = $3 WHERE organization_id = $1 AND created_by = $2', [organizationId, fromUserId, toUserId])
  await client.query('UPDATE organizations SET created_by = $3 WHERE id = $1 AND created_by = $2', [organizationId, fromUserId, toUserId])
}
async function deleteOrganization(organizationId, client) { await client.query('DELETE FROM organizations WHERE id = $1', [organizationId]) }
async function deleteUser(userId, client) { await client.query('DELETE FROM users WHERE id = $1', [userId]) }

module.exports = {
  exportCandidate, exportHirer, deleteCandidate, getMembership, otherOwners, memberCount, organizationApplicationCount,
  reassignCreator, deleteOrganization, deleteUser,
}
