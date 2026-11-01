const { pool } = require('../config/db')
const { MASKED } = require('./assessmentDefinitionModel')

/**
 * Candidate attempts, answers, coding submissions and review notes (migration 018).
 *
 * Privacy boundary: `getCandidateItems` selects ONLY public columns (question text, choice key/text, coding problem
 * statement and examples). correct_keys, explanation and coding_problems.test_cases are never selected there.
 * `getScoringItems` (answer keys) is used only by the server's scoring step and the hirer results view.
 */
const iso = (v) => (v == null ? null : new Date(v).toISOString())

const shapeAttempt = (r) => r && ({
  id: Number(r.id), invitationId: Number(r.invitation_id), assessmentId: Number(r.assessment_id), candidateId: Number(r.candidate_id),
  attemptNo: r.attempt_no, status: r.status, startedAt: iso(r.started_at), deadlineAt: iso(r.deadline_at), submittedAt: iso(r.submitted_at),
  consentVersion: r.consent_version, consentedAt: iso(r.consented_at), monitoringChoice: r.monitoring_choice, accommodationNote: r.accommodation_note,
  itemOrder: r.item_order, sectionState: r.section_state, sectionScores: r.section_scores || null,
  totalScore: r.total_score == null ? null : Number(r.total_score), maxScore: r.max_score == null ? null : Number(r.max_score),
  meetsPassMark: r.meets_pass_mark == null ? null : r.meets_pass_mark, reviewStatus: r.review_status,
})

/* ------------------------------------------------------------------ candidate: invitations */
const INVITATION_SELECT = `
  SELECT i.id AS invitation_id, i.application_id, i.created_at AS invited_at, i.revoked_at,
         x.id AS assessment_id, x.title, x.description, x.instructions, x.duration_minutes, x.available_from, x.available_until,
         x.max_attempts, x.monitoring_enabled, x.status AS assessment_status,
         j.title AS job_title, o.name AS organization_name,
         a.status AS application_status, a.consent_assessment_at IS NOT NULL AS consented, a.candidate_id,
         (SELECT count(*) FROM assessment_attempts t WHERE t.invitation_id = i.id) AS attempts_used,
         (SELECT t.id FROM assessment_attempts t WHERE t.invitation_id = i.id AND t.status = 'in_progress' LIMIT 1) AS open_attempt_id,
         (SELECT t.id FROM assessment_attempts t WHERE t.invitation_id = i.id ORDER BY t.attempt_no DESC LIMIT 1) AS latest_attempt_id,
         (SELECT t.status FROM assessment_attempts t WHERE t.invitation_id = i.id ORDER BY t.attempt_no DESC LIMIT 1) AS latest_status
    FROM assessment_invitations i
    JOIN assessments x ON x.id = i.assessment_id
    JOIN job_openings j ON j.id = x.job_id
    JOIN organizations o ON o.id = x.organization_id
    JOIN applications a ON a.id = i.application_id`

const shapeInvitation = (r) => r && ({
  invitationId: Number(r.invitation_id), applicationId: Number(r.application_id), invitedAt: iso(r.invited_at), revoked: r.revoked_at != null,
  assessment: {
    id: Number(r.assessment_id), title: r.title, description: r.description, instructions: r.instructions,
    durationMinutes: r.duration_minutes, availableFrom: iso(r.available_from), availableUntil: iso(r.available_until),
    maxAttempts: r.max_attempts, monitoringEnabled: r.monitoring_enabled, status: r.assessment_status,
  },
  jobTitle: r.job_title, organizationName: r.organization_name, applicationStatus: r.application_status, consented: r.consented,
  attemptsUsed: Number(r.attempts_used), openAttemptId: r.open_attempt_id == null ? null : Number(r.open_attempt_id),
  latestAttemptId: r.latest_attempt_id == null ? null : Number(r.latest_attempt_id), latestStatus: r.latest_status || null,
  candidateId: Number(r.candidate_id),
})

async function listInvitationsForCandidate(candidateId) {
  const { rows } = await pool.query(`${INVITATION_SELECT} WHERE a.candidate_id = $1 AND i.revoked_at IS NULL AND x.status <> 'draft' ORDER BY i.created_at DESC`, [candidateId])
  return rows.map(shapeInvitation)
}

async function getInvitationForCandidate(invitationId, candidateId, client = pool, { forUpdate = false } = {}) {
  const { rows } = await client.query(`${INVITATION_SELECT} WHERE i.id = $1 AND a.candidate_id = $2${forUpdate ? ' FOR UPDATE OF i' : ''}`, [invitationId, candidateId])
  return shapeInvitation(rows[0] || null)
}

/* ------------------------------------------------------------------ attempts */
async function createAttempt(f, client) {
  const { rows } = await client.query(
    `INSERT INTO assessment_attempts (invitation_id, assessment_id, candidate_id, attempt_no, started_at, deadline_at, consent_version,
                                      monitoring_choice, accommodation_note, item_order, section_state)
     VALUES ($1,$2,$3,$4,to_timestamp($5::double precision / 1000),to_timestamp($6::double precision / 1000),$7,$8,$9,$10::jsonb,$11::jsonb) RETURNING *`,
    [f.invitationId, f.assessmentId, f.candidateId, f.attemptNo, f.startedAtMs, f.deadlineMs, f.consentVersion, f.monitoringChoice,
      f.accommodationNote, JSON.stringify(f.itemOrder), JSON.stringify(f.sectionState)],
  )
  return shapeAttempt(rows[0])
}

async function getAttemptForCandidate(attemptId, candidateId, client = pool, { forUpdate = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM assessment_attempts WHERE id = $1 AND candidate_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [attemptId, candidateId])
  return shapeAttempt(rows[0] || null)
}

async function getAttemptById(attemptId, client = pool, { forUpdate = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM assessment_attempts WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [attemptId])
  return shapeAttempt(rows[0] || null)
}

async function saveSectionState(attemptId, state, client = pool) {
  await client.query('UPDATE assessment_attempts SET section_state = $2::jsonb WHERE id = $1', [attemptId, JSON.stringify(state)])
}

async function finalize(attemptId, { status, sectionScores, totalScore, maxScore, meetsPassMark }, client) {
  const { rows } = await client.query(
    // An expired attempt is closed lazily (on the next request), so its finish time is capped at the server deadline.
    `UPDATE assessment_attempts SET status = $2::varchar,
            submitted_at = CASE WHEN $2::varchar = 'expired' THEN LEAST(now(), deadline_at) ELSE now() END,
            section_scores = $3::jsonb, total_score = $4, max_score = $5, meets_pass_mark = $6
      WHERE id = $1 AND status = 'in_progress' RETURNING *`,
    [attemptId, status, JSON.stringify(sectionScores), totalScore, maxScore, meetsPassMark],
  )
  return shapeAttempt(rows[0] || null)
}

/** In-progress attempts whose server deadline has passed (closed lazily on the next request that touches them). */
async function listOverdueForCandidate(candidateId, client = pool) {
  const { rows } = await client.query("SELECT id FROM assessment_attempts WHERE candidate_id = $1 AND status = 'in_progress' AND deadline_at <= now()", [candidateId])
  return rows.map((r) => Number(r.id))
}

async function listOverdueForAssessment(assessmentId, client = pool) {
  const { rows } = await client.query("SELECT id FROM assessment_attempts WHERE assessment_id = $1 AND status = 'in_progress' AND deadline_at <= now()", [assessmentId])
  return rows.map((r) => Number(r.id))
}

/* ------------------------------------------------------------------ items */
/** Candidate-safe item content. NEVER add correct_keys, explanation or test_cases to this query. */
async function getCandidateItems(assessmentId, client = pool) {
  const { rows } = await client.query(
    `SELECT i.id, i.section_id, i.position, i.marks, s.kind, s.position AS section_position, s.duration_minutes, s.allow_back, s.randomize,
            s.negative_marking, q.question_text, q.question_type, q.choices,
            cp.id AS problem_id, cp.title AS problem_title, cp.description AS problem_description, cp.difficulty AS problem_difficulty,
            cp.constraints AS problem_constraints, cp.examples AS problem_examples
       FROM assessment_items i JOIN assessment_sections s ON s.id = i.section_id
       LEFT JOIN mcq_questions q ON q.id = i.mcq_question_id
       LEFT JOIN coding_problems cp ON cp.id = i.coding_problem_id
      WHERE s.assessment_id = $1 ORDER BY s.position, i.position`,
    [assessmentId],
  )
  return rows
}

/** Server-only: items with answer keys for scoring and for the hirer's per-question results. */
async function getScoringItems(assessmentId, client = pool) {
  const { rows } = await client.query(
    `SELECT i.id, i.section_id, i.position, i.marks, i.mcq_question_id, i.coding_problem_id, s.kind, s.position AS section_position,
            s.negative_marking, q.question_text, q.question_type, q.choices, q.correct_keys, q.explanation, q.category, q.difficulty,
            cp.title AS problem_title
       FROM assessment_items i JOIN assessment_sections s ON s.id = i.section_id
       LEFT JOIN mcq_questions q ON q.id = i.mcq_question_id
       LEFT JOIN coding_problems cp ON cp.id = i.coding_problem_id
      WHERE s.assessment_id = $1 ORDER BY s.position, i.position`,
    [assessmentId],
  )
  return rows
}

/* ------------------------------------------------------------------ answers */
async function upsertAnswer(attemptId, itemId, selectedKeys, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO assessment_answers (attempt_id, item_id, selected_keys) VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (attempt_id, item_id) DO UPDATE SET selected_keys = EXCLUDED.selected_keys, saved_at = now()
     RETURNING saved_at`,
    [attemptId, itemId, JSON.stringify(selectedKeys)],
  )
  return iso(rows[0].saved_at)
}

async function listAnswers(attemptId, client = pool) {
  const { rows } = await client.query('SELECT * FROM assessment_answers WHERE attempt_id = $1', [attemptId])
  return rows.map((r) => ({ itemId: Number(r.item_id), selectedKeys: r.selected_keys || [], savedAt: iso(r.saved_at), isCorrect: r.is_correct, awarded: r.awarded == null ? null : Number(r.awarded) }))
}

async function setAnswerScore(attemptId, itemId, isCorrect, awarded, client) {
  await client.query(
    `INSERT INTO assessment_answers (attempt_id, item_id, selected_keys, is_correct, awarded) VALUES ($1,$2,'[]'::jsonb,$3,$4)
     ON CONFLICT (attempt_id, item_id) DO UPDATE SET is_correct = EXCLUDED.is_correct, awarded = EXCLUDED.awarded`,
    [attemptId, itemId, isCorrect, awarded],
  )
}

/* ------------------------------------------------------------------ coding */
async function countCodingSubmissions(attemptId, itemId, client = pool) {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM assessment_coding_submissions WHERE attempt_id = $1 AND item_id = $2', [attemptId, itemId])
  return rows[0].n
}

async function insertCodingSubmission({ attemptId, itemId, language, sourceCode }, client = pool) {
  const { rows } = await client.query(
    'INSERT INTO assessment_coding_submissions (attempt_id, item_id, language, source_code) VALUES ($1,$2,$3,$4) RETURNING id',
    [attemptId, itemId, language, sourceCode],
  )
  return Number(rows[0].id)
}

async function setCodingResult(id, { status, executionStatus, testsPassed, testsTotal, executionTimeMs }, client = pool) {
  await client.query(
    'UPDATE assessment_coding_submissions SET status = $2, execution_status = $3, tests_passed = $4, tests_total = $5, execution_time_ms = $6 WHERE id = $1',
    [id, status, executionStatus, testsPassed, testsTotal, executionTimeMs ?? null],
  )
}

async function listCodingSubmissions(attemptId, client = pool, { withSource = false } = {}) {
  const { rows } = await client.query(
    `SELECT id, item_id, language, ${withSource ? 'source_code,' : ''} status, execution_status, tests_passed, tests_total, execution_time_ms, submitted_at
       FROM assessment_coding_submissions WHERE attempt_id = $1 ORDER BY submitted_at, id`,
    [attemptId],
  )
  return rows.map((r) => ({
    id: Number(r.id), itemId: Number(r.item_id), language: r.language, ...(withSource ? { sourceCode: r.source_code } : {}),
    status: r.status, executionStatus: r.execution_status, testsPassed: r.tests_passed, testsTotal: r.tests_total,
    executionTimeMs: r.execution_time_ms, submittedAt: iso(r.submitted_at),
  }))
}

/** Latest saved code per coding item (so a refreshed page can restore the candidate's work). */
async function latestCodeByItem(attemptId, client = pool) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (item_id) item_id, language, source_code FROM assessment_coding_submissions
      WHERE attempt_id = $1 ORDER BY item_id, submitted_at DESC, id DESC`,
    [attemptId],
  )
  return rows.map((r) => ({ itemId: Number(r.item_id), language: r.language, sourceCode: r.source_code }))
}

/* ------------------------------------------------------------------ hirer: results */
const ATTEMPT_LIST_SELECT = `
  SELECT t.*, a.id AS application_id, a.status AS application_status,
         CASE WHEN ${MASKED} THEN NULL ELSE u.name END AS candidate_name, ${MASKED} AS is_masked
    FROM assessment_attempts t
    JOIN assessments x ON x.id = t.assessment_id
    JOIN assessment_invitations i ON i.id = t.invitation_id
    JOIN applications a ON a.id = i.application_id
    JOIN job_openings j ON j.id = a.job_id
    JOIN users u ON u.id = a.candidate_id`

const shapeListed = (r) => ({
  ...shapeAttempt(r), applicationId: Number(r.application_id), applicationStatus: r.application_status,
  candidateName: r.candidate_name, identityHidden: r.is_masked,
})

async function listAttemptsForAssessment(assessmentId, organizationId) {
  const { rows } = await pool.query(`${ATTEMPT_LIST_SELECT} WHERE x.id = $1 AND x.organization_id = $2 ORDER BY t.started_at DESC`, [assessmentId, organizationId])
  return rows.map(shapeListed)
}

async function getAttemptScoped(attemptId, organizationId, client = pool) {
  const { rows } = await client.query(`${ATTEMPT_LIST_SELECT} WHERE t.id = $1 AND x.organization_id = $2`, [attemptId, organizationId])
  return rows[0] ? shapeListed(rows[0]) : null
}

async function setReviewStatus(attemptId, reviewStatus) {
  await pool.query('UPDATE assessment_attempts SET review_status = $2 WHERE id = $1', [attemptId, reviewStatus])
}

async function addNote(attemptId, authorId, body) {
  await pool.query('INSERT INTO assessment_review_notes (attempt_id, author_id, body) VALUES ($1,$2,$3)', [attemptId, authorId, body])
}

async function listNotes(attemptId) {
  const { rows } = await pool.query(
    `SELECT n.id, n.body, n.created_at, u.name AS author_name FROM assessment_review_notes n LEFT JOIN users u ON u.id = n.author_id
      WHERE n.attempt_id = $1 ORDER BY n.id`,
    [attemptId],
  )
  return rows.map((r) => ({ id: Number(r.id), body: r.body, createdAt: iso(r.created_at), authorName: r.author_name || 'Former member' }))
}

module.exports = {
  shapeAttempt, listInvitationsForCandidate, getInvitationForCandidate, createAttempt, getAttemptForCandidate, getAttemptById,
  saveSectionState, finalize, listOverdueForCandidate, listOverdueForAssessment, getCandidateItems, getScoringItems,
  upsertAnswer, listAnswers, setAnswerScore, countCodingSubmissions, insertCodingSubmission, setCodingResult,
  listCodingSubmissions, latestCodeByItem, listAttemptsForAssessment, getAttemptScoped, setReviewStatus, addNote, listNotes,
}
