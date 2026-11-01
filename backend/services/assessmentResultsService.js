const model = require('../models/assessmentAttemptModel')
const defs = require('../models/assessmentDefinitionModel')
const auditService = require('./auditService')
const faceMonitorService = require('./faceMonitorService')
const { loadVisible, httpError } = require('./assessmentBuilderService')
const { closeOverdue } = require('./assessmentAttemptService')

/**
 * Hirer results (migration 018). Scores come from the server's scoring step. Monitoring is reported in its own block, with
 * its limitations, and is never folded into, compared with, or used to rank against any score. The hiring decision stays
 * on the application and is always made by a person.
 */
const durationMs = (a) => (a.submittedAt ? Math.max(0, new Date(a.submittedAt) - new Date(a.startedAt)) : null)

async function listAttempts({ organization, userId, id }) {
  const a = await loadVisible(organization, userId, id)
  await closeOverdue(await model.listOverdueForAssessment(a.id))
  const rows = await model.listAttemptsForAssessment(a.id, organization.id)
  return {
    assessment: { id: a.id, title: a.title, status: a.status, passPercent: a.passPercent, jobTitle: a.jobTitle },
    attempts: rows.map((t) => ({
      id: t.id, applicationId: t.applicationId, candidateName: t.candidateName, identityHidden: t.identityHidden,
      applicationStatus: t.applicationStatus, attemptNo: t.attemptNo, status: t.status, startedAt: t.startedAt, submittedAt: t.submittedAt,
      timeTakenMs: durationMs(t), sectionScores: t.sectionScores, totalScore: t.totalScore, maxScore: t.maxScore,
      meetsPassMark: t.meetsPassMark, reviewStatus: t.reviewStatus, monitoringChoice: t.monitoringChoice,
    })),
  }
}

/** Loads an attempt the caller may see (organization + reviewer assignment). */
async function loadAttempt(organization, userId, attemptId) {
  const t = await model.getAttemptScoped(attemptId, organization.id)
  if (!t) throw httpError(404, 'Attempt not found.')
  await loadVisible(organization, userId, t.assessmentId)
  return t
}

async function getAttempt({ organization, userId, attemptId }) {
  let t = await loadAttempt(organization, userId, attemptId)
  if (t.status === 'in_progress' && Date.now() >= new Date(t.deadlineAt).getTime()) {
    await closeOverdue([t.id])
    t = await loadAttempt(organization, userId, attemptId)
  }
  const a = await defs.getForOrg(t.assessmentId, organization.id)
  const overview = {
    id: t.id, assessmentId: a.id, assessmentTitle: a.title, assessmentVersion: a.version, jobTitle: a.jobTitle,
    applicationId: t.applicationId, applicationStatus: t.applicationStatus, candidateName: t.candidateName, identityHidden: t.identityHidden,
    attemptNo: t.attemptNo, status: t.status, startedAt: t.startedAt, deadlineAt: t.deadlineAt, submittedAt: t.submittedAt, timeTakenMs: durationMs(t),
    sectionScores: t.sectionScores, totalScore: t.totalScore, maxScore: t.maxScore, passPercent: a.passPercent, meetsPassMark: t.meetsPassMark,
    reviewStatus: t.reviewStatus,
  }
  // Same layer as the application review: once a candidate withdraws, only the fact of the attempt remains visible.
  if (t.applicationStatus === 'withdrawn') return { overview, restricted: true }

  await auditService.record({ organizationId: organization.id, actorId: userId, applicationId: t.applicationId, action: 'assessment_view', detail: { assessmentAttemptId: t.id } })

  const items = await model.getScoringItems(t.assessmentId)
  const answers = new Map((await model.listAnswers(t.id)).map((x) => [x.itemId, x]))
  const subs = await model.listCodingSubmissions(t.id, undefined, { withSource: true })
  const finished = t.status !== 'in_progress'
  const mcqFor = (kind) => items.filter((i) => i.kind === kind).map((i) => {
    const ans = answers.get(Number(i.id))
    return {
      itemId: Number(i.id), questionText: i.question_text, questionType: i.question_type, category: i.category, difficulty: i.difficulty,
      choices: i.choices, marks: Number(i.marks), selectedKeys: ans ? ans.selectedKeys : [],
      // Keys and explanations are shown to the hiring team only after the attempt is finished.
      correctKeys: finished ? i.correct_keys : null, explanation: finished ? i.explanation : null,
      isCorrect: finished && ans ? ans.isCorrect : null, awarded: finished && ans ? ans.awarded : (finished ? 0 : null),
    }
  })
  const coding = items.filter((i) => i.kind === 'coding').map((i) => {
    const mine = subs.filter((s) => s.itemId === Number(i.id))
    const best = mine.filter((s) => s.testsTotal > 0).sort((x, y) => y.testsPassed / y.testsTotal - x.testsPassed / x.testsTotal)[0] || null
    return { itemId: Number(i.id), problemId: Number(i.coding_problem_id), title: i.problem_title, marks: Number(i.marks), best, submissions: mine }
  })

  const record = await faceMonitorService.recordForAttempt(t.id)
  const monitoring = {
    choice: t.monitoringChoice, accommodationNote: t.accommodationNote, issues: (t.sectionState && t.sectionState.monitoringIssues) || [],
    available: record.sessions.length > 0,
    summary: t.monitoringChoice === 'alternative'
      ? 'The candidate chose the alternative to camera monitoring. This is an accommodation, not a concern.'
      : t.monitoringChoice === 'not_required' ? 'Monitoring was not enabled for this assessment.'
        : record.sessions.length ? 'Camera monitoring ran for this attempt. Events below are observations with their measurements.'
          : 'Camera monitoring was chosen but no monitoring data is available (camera or service problem). Treat this as unavailable data, not misconduct.',
    ...record,
    notAScore: true,
  }
  return {
    overview, restricted: false,
    sections: { aptitude: mcqFor('aptitude'), technical: mcqFor('technical'), coding },
    monitoring, notes: await model.listNotes(t.id),
  }
}

async function addNote({ organization, userId, attemptId, body }) {
  const t = await loadAttempt(organization, userId, attemptId)
  const text = String(body || '').trim()
  if (!text || text.length > 4000) throw httpError(400, 'A note must be 1-4000 characters.')
  await model.addNote(t.id, userId, text)
  return { notes: await model.listNotes(t.id) }
}

async function setReviewStatus({ organization, userId, attemptId, reviewStatus }) {
  if (!['pending', 'in_review', 'reviewed'].includes(reviewStatus)) throw httpError(400, 'Review status must be pending, in_review or reviewed.')
  const t = await loadAttempt(organization, userId, attemptId)
  await model.setReviewStatus(t.id, reviewStatus)
  return { reviewStatus }
}

module.exports = { listAttempts, getAttempt, addNote, setReviewStatus }
