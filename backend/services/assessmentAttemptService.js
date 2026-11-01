const crypto = require('crypto')
const { pool } = require('../config/db')
const model = require('../models/assessmentAttemptModel')
const codingModel = require('../models/codingModel')
const codeExecutorClient = require('./codeExecutorClient')
const faceMonitorService = require('./faceMonitorService')
const faceMonitorModel = require('../models/faceMonitorModel')
const { ACTIVE_APPLICATION_STATUSES } = require('./assessmentService')
const { candidateSections, httpError, inTransaction } = require('./assessmentBuilderService')
const { sanitizeProgramText } = require('../utils/testFeedback')
const rules = require('../utils/assessmentRules')

/**
 * Candidate side of hirer assessments (migration 018).
 *
 * The server owns every decision: whether the candidate may start, the deadline (server clock), which sections are open,
 * whether an answer may still be saved, the score, and when an attempt has expired. The browser only sends selections,
 * code and enumerated monitoring issues. Answer keys and hidden test data never appear in any response built here.
 */
const MAX_CODE_RUNS_PER_ITEM = 15
// 'start_failed' is recorded by the server only (an unexpected error while creating the session); the browser cannot send it.
const MONITORING_ISSUES = ['camera_denied', 'camera_unavailable', 'camera_lost', 'service_unavailable', 'other_session_running', 'start_failed']

function eligibility(inv, now = Date.now()) {
  if (inv.revoked) return 'revoked'
  if (!ACTIVE_APPLICATION_STATUSES.includes(inv.applicationStatus)) return 'application_not_active'
  if (!inv.consented) return 'consent_required'
  const avail = rules.availability({ status: inv.assessment.status, available_from: inv.assessment.availableFrom, available_until: inv.assessment.availableUntil }, now)
  if (avail) return avail
  if (!inv.openAttemptId && inv.attemptsUsed >= inv.assessment.maxAttempts) return 'no_attempts_left'
  return null
}

const REASON_TEXT = {
  revoked: 'This invitation was withdrawn by the hiring team.',
  application_not_active: 'Assessments are only available while your application is active.',
  consent_required: 'Before starting, agree on your application page to share assessment results with the hiring team.',
  not_published: 'This assessment is not open yet.',
  closed: 'This assessment has been closed by the hiring team.',
  not_open_yet: 'This assessment opens later. Check the start time.',
  window_ended: 'The time window for this assessment has ended.',
  no_attempts_left: 'You have used all your attempts for this assessment.',
}

/* ------------------------------------------------------------------ scoring (server only) */
async function scoreAttempt(client, attempt) {
  const items = await model.getScoringItems(attempt.assessmentId, client)
  const answers = new Map((await model.listAnswers(attempt.id, client)).map((a) => [a.itemId, a]))
  const subs = await model.listCodingSubmissions(attempt.id, client)
  const sections = {}
  for (const it of items) {
    const kind = it.kind
    sections[kind] = sections[kind] || { awards: [], max: 0 }
    sections[kind].max += Number(it.marks)
    if (kind === 'coding') {
      const mine = subs.filter((s) => s.itemId === Number(it.id) && s.testsTotal > 0)
      const best = mine.sort((x, y) => y.testsPassed / y.testsTotal - x.testsPassed / x.testsTotal)[0]
      sections[kind].awards.push(rules.scoreCoding({ marks: it.marks, best: best ? { tests_passed: best.testsPassed, tests_total: best.testsTotal } : null }).awarded)
    } else {
      const a = answers.get(Number(it.id))
      const r = rules.scoreMcq({ selected: a ? a.selectedKeys : [], correctKeys: it.correct_keys, marks: it.marks, negativeMarking: it.negative_marking })
      await model.setAnswerScore(attempt.id, Number(it.id), r.isCorrect, r.awarded, client)
      sections[kind].awards.push(r.awarded)
    }
  }
  const sectionScores = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, rules.sectionTotal(v.awards, v.max)]))
  const { rows } = await client.query('SELECT pass_percent FROM assessments WHERE id = $1', [attempt.assessmentId])
  const res = rules.overall(sectionScores, rows[0] && rows[0].pass_percent != null ? Number(rows[0].pass_percent) : null)
  return { sectionScores, totalScore: res.score, maxScore: res.max, meetsPassMark: res.meetsPassMark }
}

/** Closes an attempt as submitted (or expired when the server deadline has passed). Idempotent; caller holds the row lock. */
async function finalizeLocked(client, attempt, requested) {
  if (attempt.status !== 'in_progress') return { attempt, already: true }
  const status = Date.now() >= new Date(attempt.deadlineAt).getTime() ? 'expired' : requested
  const scored = await scoreAttempt(client, attempt)
  const done = await model.finalize(attempt.id, { status, ...scored }, client)
  return { attempt: done || attempt, already: !done }
}

async function closeOverdue(ids) {
  for (const id of ids) {
    const closed = await inTransaction(async (client) => {
      const a = await model.getAttemptById(id, client, { forUpdate: true })
      if (!a || a.status !== 'in_progress' || Date.now() < new Date(a.deadlineAt).getTime()) return null
      return (await finalizeLocked(client, a, 'expired')).attempt
    })
    if (closed) await faceMonitorService.endForAttempt({ userId: closed.candidateId, attemptId: closed.id })
  }
}

/* ------------------------------------------------------------------ invitations */
function shapeInvitationForCandidate(inv) {
  const reason = eligibility(inv)
  return {
    invitationId: inv.invitationId, jobTitle: inv.jobTitle, organizationName: inv.organizationName, invitedAt: inv.invitedAt,
    assessment: inv.assessment, attemptsUsed: inv.attemptsUsed, openAttemptId: inv.openAttemptId,
    latestAttemptId: inv.latestAttemptId, latestStatus: inv.latestStatus,
    canStart: reason === null, blockedReason: reason, blockedMessage: reason ? REASON_TEXT[reason] : null,
  }
}

async function listMine(candidateId) {
  await closeOverdue(await model.listOverdueForCandidate(candidateId))
  return { invitations: (await model.listInvitationsForCandidate(candidateId)).map(shapeInvitationForCandidate) }
}

async function getInvitation(candidateId, invitationId) {
  await closeOverdue(await model.listOverdueForCandidate(candidateId))
  const inv = await model.getInvitationForCandidate(invitationId, candidateId)
  if (!inv || (inv.assessment.status === 'draft')) throw httpError(404, 'Assessment invitation not found.')
  return { invitation: shapeInvitationForCandidate(inv), monitoringNotice: inv.assessment.monitoringEnabled ? faceMonitorService.assessmentPrivacyNotice() : null, consentVersion: rules.CONSENT_VERSION }
}

/* ------------------------------------------------------------------ start / resume */
async function start({ candidateId, invitationId, acceptTerms, monitoring, accommodationNote }) {
  if (acceptTerms !== true) throw httpError(400, 'Please read and accept the assessment terms before starting.', 'terms_required')
  await closeOverdue(await model.listOverdueForCandidate(candidateId))
  return inTransaction(async (client) => {
    const inv = await model.getInvitationForCandidate(invitationId, candidateId, client, { forUpdate: true })
    if (!inv || inv.assessment.status === 'draft') throw httpError(404, 'Assessment invitation not found.')
    if (inv.openAttemptId) return { attemptId: inv.openAttemptId, resumed: true }
    const reason = eligibility(inv)
    if (reason) throw httpError(reason === 'no_attempts_left' ? 409 : 403, REASON_TEXT[reason], reason)

    let monitoringChoice = 'not_required'
    if (inv.assessment.monitoringEnabled) {
      if (!['camera', 'alternative'].includes(monitoring)) throw httpError(400, 'Choose camera monitoring or the alternative option.', 'monitoring_choice_required')
      monitoringChoice = monitoring
    }
    const note = monitoringChoice === 'alternative' && typeof accommodationNote === 'string' ? accommodationNote.trim().slice(0, 1000) || null : null

    const items = await model.getCandidateItems(inv.assessment.id, client)
    const seed = crypto.randomInt(1, 2 ** 31)
    const itemOrder = {}
    for (const s of candidateSections(items)) {
      const ids = s.items.map((i) => i.id)
      const randomize = items.find((r) => Number(r.section_id) === s.id).randomize
      itemOrder[String(s.id)] = randomize ? rules.shuffled(ids, seed + s.id) : ids
    }
    const now = Date.now()
    try {
      const attempt = await model.createAttempt({
        invitationId: inv.invitationId, assessmentId: inv.assessment.id, candidateId, attemptNo: inv.attemptsUsed + 1,
        startedAtMs: now, deadlineMs: rules.attemptDeadline(now, inv.assessment.durationMinutes, inv.assessment.availableUntil),
        consentVersion: rules.CONSENT_VERSION, monitoringChoice, accommodationNote: note, itemOrder,
        sectionState: { entered: {}, locked: [], monitoringIssues: [] },
      }, client)
      return { attemptId: attempt.id, resumed: false }
    } catch (err) {
      if (err.code === '23505') throw httpError(409, 'This assessment was just started in another window. Reload to continue.', 'already_started')
      throw err
    }
  })
}

/* ------------------------------------------------------------------ attempt state */
async function loadOwnedAttempt(candidateId, attemptId, client = pool, opts) {
  const a = await model.getAttemptForCandidate(attemptId, candidateId, client, opts)
  if (!a) throw httpError(404, 'Attempt not found.')
  return a
}

/** Expires lazily: any request after the deadline closes the attempt with what was saved, then reports it. */
async function requireOpen(candidateId, attemptId) {
  const a = await loadOwnedAttempt(candidateId, attemptId)
  if (a.status === 'in_progress' && Date.now() >= new Date(a.deadlineAt).getTime()) {
    await closeOverdue([a.id])
    throw httpError(409, 'Time is up. Your saved answers have been submitted automatically.', 'expired')
  }
  if (a.status !== 'in_progress') throw httpError(409, 'This attempt has already been submitted.', 'not_in_progress')
  return a
}

function sectionView(s, attempt, now) {
  const entered = attempt.sectionState.entered[String(s.id)] || null
  const locked = (attempt.sectionState.locked || []).map(String).includes(String(s.id))
  const deadline = rules.sectionDeadline(entered ? new Date(entered).getTime() : null, s.durationMinutes, new Date(attempt.deadlineAt).getTime())
  const timeOver = entered != null && s.durationMinutes != null && now >= deadline
  return { entered, locked, timeOver, deadlineAt: new Date(deadline).toISOString() }
}

async function getAttempt(candidateId, attemptId) {
  let a = await loadOwnedAttempt(candidateId, attemptId)
  if (a.status === 'in_progress' && Date.now() >= new Date(a.deadlineAt).getTime()) {
    await closeOverdue([a.id])
    a = await loadOwnedAttempt(candidateId, attemptId)
  }
  const inv = await model.getInvitationForCandidate(a.invitationId, candidateId)
  const now = Date.now()
  const base = {
    attempt: { id: a.id, status: a.status, attemptNo: a.attemptNo, startedAt: a.startedAt, deadlineAt: a.deadlineAt, submittedAt: a.submittedAt, monitoringChoice: a.monitoringChoice },
    assessment: { id: inv.assessment.id, title: inv.assessment.title, instructions: inv.assessment.instructions, monitoringEnabled: inv.assessment.monitoringEnabled },
    serverNow: new Date(now).toISOString(),
  }
  if (a.status !== 'in_progress') return { ...base, sections: [] }
  const sections = candidateSections(await model.getCandidateItems(a.assessmentId), a.itemOrder)
  const answers = await model.listAnswers(a.id)
  const code = await model.latestCodeByItem(a.id)
  const runs = await model.listCodingSubmissions(a.id)
  return {
    ...base,
    sections: sections.map((s) => {
      const v = sectionView(s, a, now)
      const open = v.entered != null && !v.locked
      return {
        id: s.id, kind: s.kind, position: s.position, durationMinutes: s.durationMinutes, allowBack: s.allowBack,
        negativeMarking: s.negativeMarking, itemCount: s.items.length, ...v,
        // Items are only sent for a section the candidate has entered and that is still open, so timed sections cannot be read early.
        items: open ? s.items : [],
      }
    }),
    answers: answers.map((x) => ({ itemId: x.itemId, selectedKeys: x.selectedKeys, savedAt: x.savedAt })),
    code,
    codingRuns: runs.map((r) => ({ itemId: r.itemId, status: r.status, testsPassed: r.testsPassed, testsTotal: r.testsTotal, submittedAt: r.submittedAt })),
    maxCodeRunsPerItem: MAX_CODE_RUNS_PER_ITEM,
  }
}

/** Opens a section. Earlier sections that do not allow going back are locked from then on. */
async function enterSection({ candidateId, attemptId, sectionId }) {
  await requireOpen(candidateId, attemptId)
  await inTransaction(async (client) => {
    const a = await loadOwnedAttempt(candidateId, attemptId, client, { forUpdate: true })
    if (a.status !== 'in_progress') throw httpError(409, 'This attempt has already been submitted.', 'not_in_progress')
    const { rows } = await client.query('SELECT id, position, allow_back FROM assessment_sections WHERE assessment_id = $1 ORDER BY position', [a.assessmentId])
    const target = rows.find((r) => String(r.id) === String(sectionId))
    if (!target) throw httpError(404, 'Section not found.')
    const state = { entered: { ...a.sectionState.entered }, locked: [...(a.sectionState.locked || [])].map(String), monitoringIssues: a.sectionState.monitoringIssues || [] }
    if (state.locked.includes(String(target.id))) throw httpError(409, 'This section is closed: going back to it is not allowed.', 'section_locked')
    // Leaving an entered section that does not allow going back (in either direction) closes it for the rest of the attempt.
    for (const r of rows) {
      const sid = String(r.id)
      if (sid !== String(target.id) && !r.allow_back && state.entered[sid] && !state.locked.includes(sid)) state.locked.push(sid)
    }
    if (!state.entered[String(target.id)]) state.entered[String(target.id)] = new Date().toISOString()
    await model.saveSectionState(a.id, state, client)
  })
  return getAttempt(candidateId, attemptId)
}

/** Shared checks before saving anything into an item. Returns the item's candidate-safe row. */
async function writableItem(attempt, itemId, expectCoding) {
  const items = await model.getCandidateItems(attempt.assessmentId)
  const row = items.find((r) => String(r.id) === String(itemId))
  if (!row) throw httpError(404, 'Question not found in this assessment.')
  if ((row.kind === 'coding') !== expectCoding) throw httpError(400, expectCoding ? 'That item is not a coding problem.' : 'That item is a coding problem.')
  const v = sectionView({ id: Number(row.section_id), durationMinutes: row.duration_minutes }, attempt, Date.now())
  if (!v.entered) throw httpError(409, 'Open this section first.', 'section_not_entered')
  if (v.locked) throw httpError(409, 'This section is closed: going back to it is not allowed.', 'section_locked')
  if (v.timeOver) throw httpError(409, 'Time for this section is over. Your saved answers are kept.', 'section_time_over')
  return row
}

async function saveAnswer({ candidateId, attemptId, itemId, selectedKeys }) {
  const a = await requireOpen(candidateId, attemptId)
  const row = await writableItem(a, itemId, false)
  const selection = rules.normalizeSelection(selectedKeys, row.choices)
  if (row.question_type === 'single' && selection.length > 1) throw httpError(400, 'Choose only one answer for this question.')
  const savedAt = await model.upsertAnswer(a.id, Number(row.id), selection)
  return { itemId: Number(row.id), selectedKeys: selection, savedAt }
}

function toDbStatus(executionStatus, passed, total) {
  if (executionStatus === 'completed') return passed === total && total > 0 ? 'passed' : 'failed'
  return 'error'
}

/** Runs the code through the existing Docker executor against ALL the problem's tests (read server-side). */
async function submitCoding({ candidateId, attemptId, itemId, language, sourceCode }) {
  const a = await requireOpen(candidateId, attemptId)
  const row = await writableItem(a, itemId, true)
  if ((await model.countCodingSubmissions(a.id, Number(row.id))) >= MAX_CODE_RUNS_PER_ITEM) throw httpError(409, `You have used all ${MAX_CODE_RUNS_PER_ITEM} submissions for this problem.`, 'submission_limit')
  const subId = await model.insertCodingSubmission({ attemptId: a.id, itemId: Number(row.id), language, sourceCode })
  const raw = await codingModel.getProblemTestCases(Number(row.problem_id))
  const visible = raw.map((tc) => !tc.is_hidden)
  // A 503 here leaves the row "pending": we do not know the outcome, which is different from the code failing.
  const result = await codeExecutorClient.executeCode({ language, sourceCode, testCases: raw.map((tc) => ({ input: tc.input ?? '', expectedOutput: tc.expected_output ?? '' })) })
  const status = toDbStatus(result.status, result.passedTests, result.totalTests)
  await model.setCodingResult(subId, { status, executionStatus: result.status, testsPassed: result.passedTests, testsTotal: result.totalTests, executionTimeMs: result.executionTimeMs })
  return {
    submissionId: subId, status, executionStatus: result.status, passedTests: result.passedTests, totalTests: result.totalTests,
    tests: result.tests.map((t) => ({ index: t.index, passed: t.passed, visible: Boolean(visible[t.index - 1]) })),
    stderr: sanitizeProgramText(result.stderr),
  }
}

/* ------------------------------------------------------------------ monitoring */
async function startMonitoring({ candidateId, attemptId }) {
  const a = await requireOpen(candidateId, attemptId)
  if (a.monitoringChoice !== 'camera') throw httpError(409, 'Camera monitoring was not chosen for this attempt.', 'monitoring_not_chosen')
  // After a page refresh the earlier session of THIS attempt is still running: continue it instead of failing on the
  // one-running-session rule. A running session for anything else is left alone (the candidate is told to end it).
  const running = await faceMonitorModel.getRunning(pool, candidateId)
  if (running && running.assessmentAttemptId === a.id) {
    const resumed = running.status === 'paused' ? await faceMonitorService.resumeSession({ userId: candidateId, sessionId: running.id }) : null
    const current = resumed ? { session: resumed.session } : await faceMonitorService.getSession({ userId: candidateId, sessionId: running.id })
    return { session: current.session, frameIntervalMs: faceMonitorService.FRAME_INTERVAL_MS, resumed: true }
  }
  try {
    return await faceMonitorService.createSession({ userId: candidateId, consent: true, assessmentAttemptId: a.id })
  } catch (err) {
    const reason = err.reason === 'session_already_running' ? 'other_session_running'
      : (err.statusCode === 503 ? 'service_unavailable' : 'start_failed')
    await recordMonitoringIssue({ candidateId, attemptId, issue: reason }).catch(() => {})
    throw err
  }
}

/** Technical problems only (enumerated). They are shown to reviewers as "monitoring unavailable", never as behaviour. */
async function recordMonitoringIssue({ candidateId, attemptId, issue }) {
  if (!MONITORING_ISSUES.includes(issue)) throw httpError(400, 'Unknown monitoring issue.')
  return inTransaction(async (client) => {
    const a = await loadOwnedAttempt(candidateId, attemptId, client, { forUpdate: true })
    if (a.status !== 'in_progress') return { recorded: false }
    const issues = (a.sectionState.monitoringIssues || []).slice(-49)
    issues.push({ issue, at: new Date().toISOString() })
    await model.saveSectionState(a.id, { ...a.sectionState, monitoringIssues: issues }, client)
    return { recorded: true }
  })
}

/* ------------------------------------------------------------------ submit */
async function submit({ candidateId, attemptId }) {
  const out = await inTransaction(async (client) => {
    const a = await loadOwnedAttempt(candidateId, attemptId, client, { forUpdate: true })
    return finalizeLocked(client, a, 'submitted')
  })
  await faceMonitorService.endForAttempt({ userId: candidateId, attemptId: out.attempt.id })
  return { ...(await confirmation(candidateId, attemptId)), alreadySubmitted: out.already }
}

/** What the candidate sees afterwards: that it was received, when, and how much was answered. No scores or keys. */
async function confirmation(candidateId, attemptId) {
  const a = await loadOwnedAttempt(candidateId, attemptId)
  if (a.status === 'in_progress') throw httpError(409, 'This attempt is still in progress.', 'in_progress')
  const items = await model.getCandidateItems(a.assessmentId)
  const answered = new Set((await model.listAnswers(a.id)).filter((x) => (x.selectedKeys || []).length).map((x) => x.itemId))
  const coded = new Set((await model.listCodingSubmissions(a.id)).map((x) => x.itemId))
  const bySection = {}
  for (const r of items) {
    bySection[r.kind] = bySection[r.kind] || { total: 0, answered: 0 }
    bySection[r.kind].total += 1
    if ((r.kind === 'coding' ? coded : answered).has(Number(r.id))) bySection[r.kind].answered += 1
  }
  return { attemptId: a.id, status: a.status, submittedAt: a.submittedAt, sections: bySection }
}

module.exports = {
  MAX_CODE_RUNS_PER_ITEM, MONITORING_ISSUES, eligibility, listMine, getInvitation, start, getAttempt, enterSection, saveAnswer,
  submitCoding, startMonitoring, recordMonitoringIssue, submit, confirmation, scoreAttempt, closeOverdue, finalizeLocked,
}
