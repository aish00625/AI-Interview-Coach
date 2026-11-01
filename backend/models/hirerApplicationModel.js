const { pool } = require('../config/db')
const { weeklyCountsSql } = require('../utils/weeklySeries')
const { hirerQuality } = require('../utils/answerQuality')

/**
 * Hirer-facing application queries (Phase E).
 *
 * EVERY function takes organizationId (from req.organization, never from the request) and reaches applications only
 * through `JOIN job_openings j ... j.organization_id = $org`. An application that belongs to another organization is
 * therefore indistinguishable from one that doesn't exist.
 *
 * Phase J: identity is masked IN SQL for blind-review jobs while an application is being screened, and assessment
 * results are returned only if the candidate consented to share them (applications.consent_assessment_at).
 *
 * Private data is never selected here: interview_answers.speech_metrics / cv_metrics, practice (application_id IS NULL)
 * sessions and submissions, the candidate's password hash, or other applications of the candidate.
 */

/** Blind review hides identity until the application is shortlisted or hired. */
const MASKED = `(j.blind_review AND a.status NOT IN ('shortlisted', 'hired'))`
const HAS_ASSESSMENT_CONSENT = 'a.consent_assessment_at IS NOT NULL'

const num = (v) => (v === null || v === undefined ? null : Number(v))

/* Skill matching: share of the job's required skills that the candidate lists on their profile. */
const MATCH_COLUMNS = `
  (SELECT count(*)::int FROM job_required_skills jrs WHERE jrs.job_id = a.job_id) AS skills_required,
  (SELECT count(*)::int FROM job_required_skills jrs
     JOIN user_skills us ON us.skill_id = jrs.skill_id AND us.user_id = a.candidate_id
    WHERE jrs.job_id = a.job_id) AS skills_matched`

const INTERVIEW_SCORE = `CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT s.final_score FROM interview_sessions s WHERE s.application_id = a.id AND s.status = 'completed') END AS interview_score`
const INTERVIEW_STATUS = `CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT s.status FROM interview_sessions s WHERE s.application_id = a.id) END AS interview_status`
const CODING_SUMMARY = `
  CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT count(DISTINCT cs.problem_id)::int FROM coding_submissions cs WHERE cs.application_id = a.id AND cs.status = 'passed') END AS coding_problems_passed,
  (SELECT count(*)::int FROM job_assessment_problems jap WHERE jap.job_id = a.job_id) AS coding_problems_assigned,
  CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT count(DISTINCT cs.problem_id)::int FROM coding_submissions cs WHERE cs.application_id = a.id) END AS coding_problems_attempted`
const CONSENT_COLUMNS = `(a.consent_resume_at IS NOT NULL) AS consent_resume, (${HAS_ASSESSMENT_CONSENT}) AS consent_assessment`
const SCORECARD_COUNT = `(SELECT count(*)::int FROM application_scorecards sc WHERE sc.application_id = a.id) AS scorecard_count`

function shapeSummary(r) {
  const required = r.skills_required
  const { is_masked: masked, ...rest } = r
  return {
    ...rest,
    candidate_name: masked ? `Applicant #${r.id}` : r.candidate_name,
    identity_hidden: Boolean(masked),
    interview_score: num(r.interview_score),
    skill_match_percent: required > 0 ? Math.round((r.skills_matched / required) * 100) : null,
  }
}

async function getJobForOrg(jobId, organizationId) {
  const { rows } = await pool.query('SELECT id, title, status FROM job_openings WHERE id = $1 AND organization_id = $2', [jobId, organizationId])
  return rows[0] || null
}

const SORTS = {
  newest: 'a.created_at DESC, a.id DESC',
  oldest: 'a.created_at ASC, a.id ASC',
  match: 'skills_matched DESC, a.created_at ASC',
  interview: 'interview_score DESC NULLS LAST, a.created_at ASC',
}

async function listForJob(jobId, organizationId, { status = null, search = null, sort = 'newest' } = {}) {
  const order = SORTS[sort] || SORTS.newest
  const { rows } = await pool.query(
    `SELECT a.id, a.job_id, a.status, a.created_at, a.updated_at,
            CASE WHEN ${MASKED} THEN NULL ELSE u.name END AS candidate_name,
            CASE WHEN ${MASKED} THEN NULL ELSE u.email END AS candidate_email,
            ${MASKED} AS is_masked,
            p.experience_level, p.target_role,
            ${MATCH_COLUMNS}, ${INTERVIEW_SCORE}, ${INTERVIEW_STATUS}, ${CODING_SUMMARY}, ${CONSENT_COLUMNS}, ${SCORECARD_COUNT}
       FROM applications a
       JOIN job_openings j ON j.id = a.job_id
       JOIN users u ON u.id = a.candidate_id
       LEFT JOIN profiles p ON p.user_id = a.candidate_id
      WHERE a.job_id = $1 AND j.organization_id = $2
        AND ($3::text IS NULL OR a.status = $3)
        AND ($4::text IS NULL OR (NOT ${MASKED} AND (u.name ILIKE '%' || $4 || '%' OR u.email ILIKE '%' || $4 || '%')))
      ORDER BY (a.status = 'withdrawn') ASC, ${order}`,
    [jobId, organizationId, status, search],
  )
  return rows.map(shapeSummary)
}

/** Core row used by every single-application operation. Null when not in this organization. */
async function getScoped(applicationId, organizationId, client = pool, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT a.id, a.job_id, a.candidate_id, a.resume_id, a.status, a.cover_note, a.created_at, a.updated_at,
            a.consent_resume_at, a.consent_assessment_at,
            j.title AS job_title, j.organization_id, j.blind_review, j.scorecard_criteria, ${MASKED} AS is_masked,
            (SELECT o.name FROM organizations o WHERE o.id = j.organization_id) AS organization_name
       FROM applications a JOIN job_openings j ON j.id = a.job_id
      WHERE a.id = $1 AND j.organization_id = $2 ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [applicationId, organizationId],
  )
  return rows[0] || null
}

async function getCandidateProfile(applicationId, organizationId) {
  const { rows } = await pool.query(
    `SELECT CASE WHEN ${MASKED} THEN NULL ELSE u.name END AS name, CASE WHEN ${MASKED} THEN NULL ELSE u.email END AS email, p.target_role, p.experience_level, p.preferred_language,
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name,
                        'required', EXISTS (SELECT 1 FROM job_required_skills jrs WHERE jrs.job_id = a.job_id AND jrs.skill_id = s.id)) ORDER BY s.name)
                        FROM user_skills us JOIN skills s ON s.id = us.skill_id WHERE us.user_id = a.candidate_id), '[]'::json) AS skills,
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'mandatory', jrs.is_mandatory,
                        'matched', EXISTS (SELECT 1 FROM user_skills us WHERE us.user_id = a.candidate_id AND us.skill_id = s.id)) ORDER BY s.name)
                        FROM job_required_skills jrs JOIN skills s ON s.id = jrs.skill_id WHERE jrs.job_id = a.job_id), '[]'::json) AS required_skills
       FROM applications a
       JOIN job_openings j ON j.id = a.job_id
       JOIN users u ON u.id = a.candidate_id
       LEFT JOIN profiles p ON p.user_id = a.candidate_id
      WHERE a.id = $1 AND j.organization_id = $2`,
    [applicationId, organizationId],
  )
  return rows[0] || null
}

async function getResumeForApplication(applicationId, organizationId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.original_filename, r.content_type, r.size_bytes, r.storage_key, r.extraction_status, r.extracted_text
       FROM applications a
       JOIN job_openings j ON j.id = a.job_id
       JOIN resumes r ON r.id = a.resume_id
      WHERE a.id = $1 AND j.organization_id = $2`,
    [applicationId, organizationId],
  )
  return rows[0] || null
}

async function getHistory(applicationId) {
  const { rows } = await pool.query(
    `SELECT h.id, h.from_status, h.to_status, h.note, h.reason_code, h.created_at,
            CASE WHEN h.changed_by = a.candidate_id THEN 'candidate' ELSE 'hiring_team' END AS actor
       FROM application_status_history h JOIN applications a ON a.id = h.application_id
      WHERE h.application_id = $1 ORDER BY h.id`,
    [applicationId],
  )
  return rows
}

async function getNotes(applicationId) {
  const { rows } = await pool.query(
    `SELECT n.id, n.body, n.created_at, u.name AS author_name
       FROM application_notes n LEFT JOIN users u ON u.id = n.author_id
      WHERE n.application_id = $1 ORDER BY n.id`,
    [applicationId],
  )
  return rows
}

async function addNote({ applicationId, authorId, body }) {
  const { rows } = await pool.query(
    'INSERT INTO application_notes (application_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
    [applicationId, authorId, body],
  )
  return rows[0].id
}

/** Interview assessment as the hiring team may see it: answers + 4 AI scores + strengths/weaknesses. NO speech/video metrics. */
async function getInterviewResult(applicationId) {
  const { rows: sessions } = await pool.query(
    `SELECT id, status, interview_type, difficulty, final_score, started_at, completed_at
       FROM interview_sessions WHERE application_id = $1`,
    [applicationId],
  )
  const session = sessions[0]
  if (!session) return null
  const { rows } = await pool.query(
    `SELECT q.order_index, q.question_text, t.name AS topic,
            ia.answer_text, ia.audio_transcript,
            ia.technical_score, ia.relevance_score, ia.clarity_score, ia.completeness_score,
            ia.strengths, ia.weaknesses,
            ia.evaluation_meta->'answerQuality'->>'status' AS quality_status, ia.evaluation_meta->>'confidence' AS quality_confidence,
            ia.evaluation_meta->>'attemptCount' AS quality_attempts
       FROM interview_questions q
       LEFT JOIN interview_answers ia ON ia.question_id = q.id
       LEFT JOIN topics t ON t.id = q.topic_id
      WHERE q.session_id = $1 ORDER BY q.order_index`,
    [session.id],
  )
  return {
    status: session.status, interviewType: session.interview_type, difficulty: session.difficulty,
    finalScore: num(session.final_score), startedAt: session.started_at, completedAt: session.completed_at,
    questions: rows.map((r) => ({
      orderIndex: r.order_index, question: r.question_text, topic: r.topic,
      answer: r.answer_text ?? r.audio_transcript ?? null, answered: r.answer_text != null || r.audio_transcript != null,
      scores: r.technical_score == null ? null : {
        technical: num(r.technical_score), relevance: num(r.relevance_score), clarity: num(r.clarity_score), completeness: num(r.completeness_score),
      },
      strengths: r.strengths || [], weaknesses: r.weaknesses || [],
      // Only whether the scores can be trusted (status + low-confidence flag + how many attempts); never the rest of the stored evaluation.
      quality: hirerQuality(r.quality_status, r.quality_confidence, r.quality_attempts),
    })),
  }
}

async function getCodingResult(applicationId, jobId) {
  const { rows: problems } = await pool.query(
    `SELECT cp.id, cp.title, cp.difficulty FROM job_assessment_problems jap
       JOIN coding_problems cp ON cp.id = jap.problem_id WHERE jap.job_id = $1 ORDER BY jap.position, cp.id`,
    [jobId],
  )
  const { rows: subs } = await pool.query(
    `SELECT id, problem_id, language, status, test_cases_passed, test_cases_total, execution_time_ms, submitted_at, source_code
       FROM coding_submissions WHERE application_id = $1 ORDER BY submitted_at, id`,
    [applicationId],
  )
  return problems.map((p) => {
    const attempts = subs.filter((s) => s.problem_id === p.id || String(s.problem_id) === String(p.id))
    const best = [...attempts].sort((a, b) => (b.status === 'passed') - (a.status === 'passed') || b.test_cases_passed - a.test_cases_passed || new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null
    return {
      problemId: p.id, title: p.title, difficulty: p.difficulty, attemptCount: attempts.length,
      best: best && {
        submissionId: best.id, language: best.language, status: best.status, testsPassed: best.test_cases_passed, testsTotal: best.test_cases_total,
        executionTimeMs: best.execution_time_ms, submittedAt: best.submitted_at, sourceCode: best.source_code,
      },
      attempts: attempts.map((s) => ({ submissionId: s.id, language: s.language, status: s.status, testsPassed: s.test_cases_passed, testsTotal: s.test_cases_total, submittedAt: s.submitted_at })),
    }
  })
}

/** Conditional status change (concurrency guard). */
async function changeStatus({ applicationId, from, to }, client = pool) {
  const { rows } = await client.query(
    'UPDATE applications SET status = $3::text WHERE id = $1 AND status = $2::text RETURNING id',
    [applicationId, from, to],
  )
  return rows.length > 0
}

/** One query for the comparison table: only applications of this job AND organization. */
async function getComparisonRows(jobId, organizationId, applicationIds) {
  const { rows } = await pool.query(
    `SELECT a.id, a.status, a.created_at, CASE WHEN ${MASKED} THEN NULL ELSE u.name END AS candidate_name, ${MASKED} AS is_masked, p.experience_level,
            ${MATCH_COLUMNS}, ${INTERVIEW_SCORE}, ${CODING_SUMMARY}, ${CONSENT_COLUMNS}, ${SCORECARD_COUNT},
            COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM job_required_skills jrs JOIN skills s ON s.id = jrs.skill_id
                       JOIN user_skills us ON us.skill_id = jrs.skill_id AND us.user_id = a.candidate_id WHERE jrs.job_id = a.job_id), '[]'::json) AS matched_skills,
            COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM job_required_skills jrs JOIN skills s ON s.id = jrs.skill_id
                       WHERE jrs.job_id = a.job_id AND NOT EXISTS (SELECT 1 FROM user_skills us WHERE us.skill_id = jrs.skill_id AND us.user_id = a.candidate_id)), '[]'::json) AS missing_skills,
            CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT count(*)::int FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id
               JOIN interview_sessions s ON s.id = q.session_id WHERE s.application_id = a.id) END AS answers_total,
            CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT count(*)::int FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id
               JOIN interview_sessions s ON s.id = q.session_id WHERE s.application_id = a.id AND ia.evaluation_meta->'answerQuality'->>'status' = 'not_evaluable') END AS answers_not_evaluable,
            CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT count(*)::int FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id
               JOIN interview_sessions s ON s.id = q.session_id WHERE s.application_id = a.id AND ia.evaluation_meta->>'confidence' = 'low'
                 AND COALESCE(ia.evaluation_meta->'answerQuality'->>'status', '') <> 'not_evaluable') END AS answers_low_confidence,
            CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT avg(ia.technical_score) FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id
               JOIN interview_sessions s ON s.id = q.session_id WHERE s.application_id = a.id) END AS avg_technical,
            CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT avg(ia.relevance_score) FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id
               JOIN interview_sessions s ON s.id = q.session_id WHERE s.application_id = a.id) END AS avg_relevance,
            CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT avg(ia.clarity_score) FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id
               JOIN interview_sessions s ON s.id = q.session_id WHERE s.application_id = a.id) END AS avg_clarity,
            CASE WHEN ${HAS_ASSESSMENT_CONSENT} THEN (SELECT avg(ia.completeness_score) FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id
               JOIN interview_sessions s ON s.id = q.session_id WHERE s.application_id = a.id) END AS avg_completeness
       FROM applications a
       JOIN job_openings j ON j.id = a.job_id
       JOIN users u ON u.id = a.candidate_id
       LEFT JOIN profiles p ON p.user_id = a.candidate_id
      WHERE a.job_id = $1 AND j.organization_id = $2 AND a.id = ANY($3::bigint[])
      ORDER BY a.id`,
    [jobId, organizationId, applicationIds],
  )
  return rows.map((r) => ({
    ...shapeSummary(r),
    answers_total: num(r.answers_total), answers_not_evaluable: num(r.answers_not_evaluable), answers_low_confidence: num(r.answers_low_confidence),
    avg_technical: num(r.avg_technical), avg_relevance: num(r.avg_relevance), avg_clarity: num(r.avg_clarity), avg_completeness: num(r.avg_completeness),
  }))
}

/* ---------------------------- dashboard ---------------------------- */

async function getDashboard(organizationId) {
  const { rows: jobRows } = await pool.query(
    `SELECT status, count(*)::int AS n FROM job_openings WHERE organization_id = $1 GROUP BY status`, [organizationId])
  const { rows: appRows } = await pool.query(
    `SELECT a.status, count(*)::int AS n FROM applications a JOIN job_openings j ON j.id = a.job_id
      WHERE j.organization_id = $1 GROUP BY a.status`, [organizationId])
  const { rows: perJob } = await pool.query(
    `SELECT j.id, j.title, j.status,
            count(a.id) FILTER (WHERE a.status <> 'withdrawn')::int AS applicants,
            count(a.id) FILTER (WHERE a.status = 'submitted')::int AS awaiting_review,
            count(a.id) FILTER (WHERE a.status = 'shortlisted')::int AS shortlisted,
            count(a.id) FILTER (WHERE a.status = 'under_review')::int AS under_review,
            count(a.id) FILTER (WHERE a.status = 'hired')::int AS hired
       FROM job_openings j LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.organization_id = $1 GROUP BY j.id ORDER BY j.created_at DESC, j.id DESC`, [organizationId])
  const { rows: recent } = await pool.query(
    `SELECT a.id, a.status, a.created_at, CASE WHEN ${MASKED} THEN 'Applicant #' || a.id ELSE u.name END AS candidate_name, j.id AS job_id, j.title AS job_title
       FROM applications a JOIN job_openings j ON j.id = a.job_id JOIN users u ON u.id = a.candidate_id
      WHERE j.organization_id = $1 AND a.status <> 'withdrawn' ORDER BY a.created_at DESC, a.id DESC LIMIT 8`, [organizationId])
  // Organization-scoped trend and responsiveness: the org id is the only parameter and every row is joined through job_openings.
  const { rows: weekly } = await pool.query(
    weeklyCountsSql({ fromSql: 'applications a JOIN job_openings j ON j.id = a.job_id', tsColumn: 'a.created_at', whereSql: 'j.organization_id = $1' }), [organizationId])
  const { rows: ttr } = await pool.query(
    `SELECT avg(extract(epoch FROM (h.first_at - a.created_at)) / 86400.0) AS days, count(*)::int AS n
       FROM applications a JOIN job_openings j ON j.id = a.job_id
       JOIN (SELECT application_id, min(created_at) AS first_at FROM application_status_history WHERE from_status = 'submitted' GROUP BY application_id) h ON h.application_id = a.id
      WHERE j.organization_id = $1`, [organizationId])
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.n]))
  return {
    jobsByStatus: toMap(jobRows), applicationsByStatus: toMap(appRows), jobs: perJob, recentApplications: recent,
    applicationsByWeek: weekly,
    // Average days from application to the first status change out of "submitted"; null until at least one has been reviewed.
    firstReview: { averageDays: ttr[0].days == null ? null : Math.round(Number(ttr[0].days) * 10) / 10, reviewedApplications: ttr[0].n },
  }
}

module.exports = {
  MASKED,
  getJobForOrg, listForJob, getScoped, getCandidateProfile, getResumeForApplication, getHistory, getNotes, addNote,
  getInterviewResult, getCodingResult, changeStatus, getComparisonRows, getDashboard,
}
