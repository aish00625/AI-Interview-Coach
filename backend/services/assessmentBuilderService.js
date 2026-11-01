const { pool } = require('../config/db')
const defs = require('../models/assessmentDefinitionModel')
const attempts = require('../models/assessmentAttemptModel')
const mcq = require('../models/mcqQuestionModel')
const jobModel = require('../models/jobModel')
const assessmentModel = require('../models/assessmentModel')
const hiringTeamModel = require('../models/hiringTeamModel')
const notificationModel = require('../models/notificationModel')
const { ACTIVE_APPLICATION_STATUSES } = require('./assessmentService')
const rules = require('../utils/assessmentRules')

/**
 * Hirer: build, publish and invite (migration 018). Organization scoping comes from req.organization (database), never
 * from the request. Reviewers only ever see assessments they are assigned to (404 otherwise, like any foreign id).
 * Once an assessment has an attempt it is frozen; changes go into a new version.
 */
function httpError(statusCode, message, reason) {
  const err = new Error(message)
  err.statusCode = statusCode
  if (reason) err.reason = reason
  return err
}

async function inTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Loads an assessment the caller may see: their organization's, and for reviewers only when assigned. */
async function loadVisible(organization, userId, id, client = pool, opts) {
  const a = await defs.getForOrg(id, organization.id, client, opts)
  if (!a) throw httpError(404, 'Assessment not found.')
  if (organization.member_role === 'reviewer' && !(await defs.isReviewer(a.id, userId, client))) throw httpError(404, 'Assessment not found.')
  return a
}

const toDate = (v, name) => {
  if (v == null || v === '') return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw httpError(400, `${name} is not a valid date and time.`)
  return d.toISOString()
}

async function parseDetails(organizationId, input) {
  const jobId = Number(input.jobId)
  if (!Number.isInteger(jobId) || jobId < 1) throw httpError(400, 'Choose the job this assessment is for.')
  if (!(await jobModel.getJobForOrg(jobId, organizationId))) throw httpError(400, 'That job does not belong to your organization.')
  const title = String(input.title || '').trim()
  if (title.length < 3 || title.length > 200) throw httpError(400, 'The title must be 3-200 characters.')
  const durationMinutes = Number(input.durationMinutes)
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 600) throw httpError(400, 'Duration must be a whole number of minutes from 5 to 600.')
  const maxAttempts = input.maxAttempts == null ? 1 : Number(input.maxAttempts)
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw httpError(400, 'Maximum attempts must be 1 to 5.')
  const passPercent = input.passPercent == null || input.passPercent === '' ? null : Number(input.passPercent)
  if (passPercent != null && (!Number.isFinite(passPercent) || passPercent < 0 || passPercent > 100)) throw httpError(400, 'The pass mark must be a percentage from 0 to 100.')
  const availableFrom = toDate(input.availableFrom, 'Start of availability')
  const availableUntil = toDate(input.availableUntil, 'End of availability')
  if (availableFrom && availableUntil && new Date(availableUntil) <= new Date(availableFrom)) throw httpError(400, 'Availability must end after it starts.')
  const text = (v, max) => { const s = typeof v === 'string' ? v.trim() : ''; if (s.length > max) throw httpError(400, `A text field is too long (max ${max} characters).`); return s || null }
  return {
    jobId, title, description: text(input.description, 4000), instructions: text(input.instructions, 8000), durationMinutes,
    availableFrom, availableUntil, maxAttempts, passPercent, monitoringEnabled: input.monitoringEnabled !== false,
  }
}

/** Validates sections and items against the organization's question bank and the coding catalogue. */
async function parseSections(organizationId, input, client) {
  const list = Array.isArray(input) ? input : []
  if (list.length > 3) throw httpError(400, 'An assessment has at most three sections.')
  const kinds = list.map((s) => s && s.kind)
  if (kinds.some((k) => !rules.SECTION_KINDS.includes(k))) throw httpError(400, 'Section kind must be aptitude, technical or coding.')
  if (new Set(kinds).size !== kinds.length) throw httpError(400, 'Each section kind can appear only once.')
  const mcqIds = list.filter((s) => s.kind !== 'coding').flatMap((s) => (s.items || []).map((i) => Number(i.mcqQuestionId)))
  const questions = new Map((await mcq.getManyForOrg(mcqIds.filter((n) => Number.isInteger(n) && n > 0), organizationId, client)).map((q) => [q.id, q]))
  const out = []
  for (const [idx, s] of list.entries()) {
    const items = Array.isArray(s.items) ? s.items : []
    if (items.length > rules.MAX_ITEMS_PER_SECTION[s.kind]) throw httpError(400, `The ${s.kind} section can have at most ${rules.MAX_ITEMS_PER_SECTION[s.kind]} items.`)
    const durationMinutes = s.durationMinutes == null || s.durationMinutes === '' ? null : Number(s.durationMinutes)
    if (durationMinutes != null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600)) throw httpError(400, 'Section duration must be 1-600 minutes, or empty.')
    const negativeMarking = s.kind === 'coding' ? 0 : Number(s.negativeMarking || 0)
    if (!Number.isFinite(negativeMarking) || negativeMarking < 0 || negativeMarking > 1) throw httpError(400, 'Negative marking is a fraction of the question\'s marks from 0 to 1 (for example 0.25).')
    const parsedItems = []
    const seen = new Set()
    for (const it of items) {
      if (s.kind === 'coding') {
        const problemId = Number(it.codingProblemId)
        if (!Number.isInteger(problemId) || problemId < 1) throw httpError(400, 'Coding items need a coding problem.')
        if (seen.has(problemId)) throw httpError(400, 'A coding problem appears twice in the same section.')
        seen.add(problemId)
        parsedItems.push({ codingProblemId: problemId, marks: rules.round2(Number(it.marks ?? 10)) })
      } else {
        const qid = Number(it.mcqQuestionId)
        const q = questions.get(qid)
        if (!q) throw httpError(400, 'A selected question does not exist in your question bank.')
        if (q.sectionKind !== s.kind) throw httpError(400, `"${q.questionText.slice(0, 40)}..." is a ${q.sectionKind} question and cannot go in the ${s.kind} section.`)
        if (seen.has(qid)) throw httpError(400, 'A question appears twice in the same section.')
        seen.add(qid)
        parsedItems.push({ mcqQuestionId: qid, marks: rules.round2(Number(it.marks ?? q.marks)) })
      }
    }
    if (parsedItems.some((i) => !Number.isFinite(i.marks) || i.marks <= 0 || i.marks > 100)) throw httpError(400, 'Marks per item must be more than 0 and at most 100.')
    out.push({ kind: s.kind, position: idx + 1, durationMinutes, allowBack: s.allowBack !== false, randomize: Boolean(s.randomize) && s.kind !== 'coding', negativeMarking, items: parsedItems })
  }
  const codingIds = out.filter((s) => s.kind === 'coding').flatMap((s) => s.items.map((i) => i.codingProblemId))
  if (codingIds.length && (await assessmentModel.countExistingProblems(codingIds, client)) !== codingIds.length) throw httpError(400, 'A selected coding problem does not exist.')
  return out
}

/** Full hirer view of one assessment. */
async function detail(organization, userId, id) {
  const a = await loadVisible(organization, userId, id)
  const sections = await defs.getSections(a.id)
  const itemsBySection = Object.fromEntries(sections.map((s) => [s.id, s.items.map((i) => ({ ...i, coding_problem_id: i.codingProblemId, archived: i.archived }))]))
  const problems = a.status === 'draft'
    ? rules.publishProblems({ title: a.title, instructions: a.instructions, duration_minutes: a.durationMinutes, available_until: a.availableUntil },
      sections.map((s) => ({ id: s.id, kind: s.kind, position: s.position, duration_minutes: s.durationMinutes, negative_marking: s.negativeMarking })), itemsBySection)
    : []
  const hasAttempts = await defs.hasAttempts(a.id)
  const totalMarks = rules.round2(sections.reduce((sum, s) => sum + s.items.reduce((x, i) => x + i.marks, 0), 0))
  return { assessment: a, sections, reviewers: await defs.listReviewers(a.id), publishProblems: problems, hasAttempts, editable: a.status === 'draft' && !hasAttempts, totalMarks }
}

async function list(organization, userId) {
  return { assessments: await defs.listForOrg(organization.id, { reviewerUserId: organization.member_role === 'reviewer' ? userId : null }) }
}

async function create({ organization, userId, input }) {
  const details = await parseDetails(organization.id, input)
  const id = await inTransaction(async (client) => {
    const sections = await parseSections(organization.id, input.sections, client)
    const newId = await defs.create(organization.id, userId, details, client)
    await defs.replaceSections(newId, sections, client)
    return newId
  })
  return detail(organization, userId, id)
}

async function update({ organization, userId, id, input }) {
  const details = await parseDetails(organization.id, input)
  await inTransaction(async (client) => {
    const a = await loadVisible(organization, userId, id, client, { forUpdate: true })
    if (a.status !== 'draft') throw httpError(409, 'Only drafts can be edited. Create a new version to change a published or closed assessment.', 'not_draft')
    if (await defs.hasAttempts(a.id, client)) throw httpError(409, 'Candidates have attempted this assessment; create a new version instead.', 'has_attempts')
    const sections = await parseSections(organization.id, input.sections, client)
    await defs.update(a.id, organization.id, details, client)
    await defs.replaceSections(a.id, sections, client)
  })
  return detail(organization, userId, id)
}

async function publish({ organization, userId, id }) {
  await inTransaction(async (client) => {
    const a = await loadVisible(organization, userId, id, client, { forUpdate: true })
    if (a.status !== 'draft') throw httpError(409, `This assessment is already ${a.status}.`, 'not_draft')
    const sections = await defs.getSections(a.id, client)
    const problems = rules.publishProblems(
      { title: a.title, instructions: a.instructions, duration_minutes: a.durationMinutes, available_until: a.availableUntil },
      sections.map((s) => ({ id: s.id, kind: s.kind, position: s.position, duration_minutes: s.durationMinutes, negative_marking: s.negativeMarking })),
      Object.fromEntries(sections.map((s) => [s.id, s.items.map((i) => ({ coding_problem_id: i.codingProblemId, archived: i.archived }))])),
    )
    if (problems.length) throw httpError(422, `Not ready to publish: ${problems.join(' ')}`, 'not_publishable')
    await defs.setStatus(a.id, organization.id, 'published', client)
  })
  return detail(organization, userId, id)
}

/** Closing stops new starts. Attempts already in progress may finish until their own server deadline. */
async function close({ organization, userId, id }) {
  await inTransaction(async (client) => {
    const a = await loadVisible(organization, userId, id, client, { forUpdate: true })
    if (a.status !== 'published') throw httpError(409, 'Only a published assessment can be closed.', 'not_published')
    await defs.setStatus(a.id, organization.id, 'closed', client)
  })
  return detail(organization, userId, id)
}

/** Copies any assessment into a new DRAFT version (questions are referenced, not duplicated). Attempts stay on the old one. */
async function newVersion({ organization, userId, id }) {
  const source = await detail(organization, userId, id)
  const a = source.assessment
  const newId = await inTransaction(async (client) => {
    const version = (await defs.maxVersionInLineage(a.id, organization.id, client)) + 1
    const nid = await defs.create(organization.id, userId, {
      jobId: a.jobId, title: a.title, description: a.description, instructions: a.instructions, durationMinutes: a.durationMinutes,
      availableFrom: null, availableUntil: null, maxAttempts: a.maxAttempts, passPercent: a.passPercent, monitoringEnabled: a.monitoringEnabled,
      version, parentId: a.id,
    }, client)
    await defs.replaceSections(nid, source.sections.map((s) => ({
      kind: s.kind, position: s.position, durationMinutes: s.durationMinutes, allowBack: s.allowBack, randomize: s.randomize, negativeMarking: s.negativeMarking,
      items: s.items.map((i) => ({ mcqQuestionId: i.mcqQuestionId, codingProblemId: i.codingProblemId, marks: i.marks })),
    })), client)
    return nid
  })
  return detail(organization, userId, newId)
}

/** Builds the candidate-shaped view of the sections (shared with the candidate service). No answer keys, ever. */
function candidateSections(itemRows, itemOrder = null) {
  const bySection = new Map()
  for (const r of itemRows) {
    const sid = String(r.section_id)
    if (!bySection.has(sid)) {
      bySection.set(sid, {
        id: Number(r.section_id), kind: r.kind, position: r.section_position, durationMinutes: r.duration_minutes,
        allowBack: r.allow_back, negativeMarking: Number(r.negative_marking), items: [],
      })
    }
    const item = { id: Number(r.id), marks: Number(r.marks) }
    if (r.kind === 'coding') {
      item.coding = { problemId: Number(r.problem_id), title: r.problem_title, description: r.problem_description, difficulty: r.problem_difficulty, constraints: r.problem_constraints, examples: r.problem_examples || [] }
    } else {
      item.question = rules.candidateQuestion(r)
    }
    bySection.get(sid).items.push(item)
  }
  const sections = [...bySection.values()].sort((x, y) => x.position - y.position)
  if (itemOrder) {
    for (const s of sections) {
      const order = itemOrder[String(s.id)]
      if (Array.isArray(order)) { const idx = new Map(order.map((id, i) => [Number(id), i])); s.items.sort((x, y) => (idx.get(x.id) ?? 1e9) - (idx.get(y.id) ?? 1e9)) }
    }
  }
  return sections
}

async function preview({ organization, userId, id }) {
  const a = await loadVisible(organization, userId, id)
  return {
    assessment: { id: a.id, title: a.title, description: a.description, instructions: a.instructions, durationMinutes: a.durationMinutes, monitoringEnabled: a.monitoringEnabled },
    sections: candidateSections(await attempts.getCandidateItems(a.id)),
  }
}

async function setReviewers({ organization, userId, id, userIds }) {
  const ids = [...new Set((userIds || []).map(Number))]
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) throw httpError(400, 'Reviewer ids must be positive integers.')
  await inTransaction(async (client) => {
    const a = await loadVisible(organization, userId, id, client, { forUpdate: true })
    for (const uid of ids) {
      if (!(await hiringTeamModel.getMember(organization.id, uid, client))) throw httpError(400, 'Every reviewer must be a member of your hiring team.')
    }
    await defs.replaceReviewers(a.id, ids, userId, client)
  })
  return { reviewers: await defs.listReviewers(id) }
}

async function listCandidates({ organization, userId, id }) {
  const a = await loadVisible(organization, userId, id)
  return { assessment: { id: a.id, title: a.title, status: a.status, jobId: a.jobId, jobTitle: a.jobTitle, maxAttempts: a.maxAttempts }, candidates: await defs.listCandidates(a.id, organization.id) }
}

/**
 * Invites applications of the assessment's job. Each must be active and have consented to sharing assessment results;
 * anything else is skipped with a reason (never silently). The candidate gets an in-app notification.
 */
async function invite({ organization, userId, id, applicationIds }) {
  const ids = [...new Set((applicationIds || []).map(Number))].filter((n) => Number.isInteger(n) && n > 0)
  if (!ids.length) throw httpError(400, 'Choose at least one applicant to invite.')
  if (ids.length > 200) throw httpError(400, 'Invite at most 200 applicants at a time.')
  return inTransaction(async (client) => {
    const a = await loadVisible(organization, userId, id, client, { forUpdate: true })
    if (a.status !== 'published') throw httpError(409, 'Publish the assessment before inviting candidates.', 'not_published')
    const apps = new Map((await defs.getApplicationsForInvite(a.id, organization.id, ids, client)).map((r) => [Number(r.id), r]))
    const invited = []
    const skipped = []
    for (const appId of ids) {
      const app = apps.get(appId)
      if (!app) { skipped.push({ applicationId: appId, reason: 'not_an_applicant_for_this_job' }); continue }
      if (!ACTIVE_APPLICATION_STATUSES.includes(app.status)) { skipped.push({ applicationId: appId, reason: 'application_not_active' }); continue }
      if (app.consent_assessment_at == null) { skipped.push({ applicationId: appId, reason: 'no_assessment_consent' }); continue }
      const inv = await defs.upsertInvitation(a.id, appId, userId, client)
      invited.push({ applicationId: appId, invitationId: inv.id })
      await notificationModel.create({
        userId: Number(app.candidate_id), type: 'assessment_invitation', applicationId: appId,
        title: `Assessment invitation: ${a.title}`, body: `${organization.name} invited you to take "${a.title}" for ${a.jobTitle}. Open My assessments to read the instructions.`,
      }, client)
    }
    return { invited, skipped }
  })
}

async function revokeInvitation({ organization, userId, id, invitationId }) {
  const a = await loadVisible(organization, userId, id)
  if (!(await defs.revokeInvitation(invitationId, a.id, organization.id))) throw httpError(404, 'Invitation not found.')
  return { revoked: true }
}

module.exports = {
  loadVisible, detail, list, create, update, publish, close, newVersion, preview, setReviewers, listCandidates, invite,
  revokeInvitation, candidateSections, httpError, inTransaction,
}
