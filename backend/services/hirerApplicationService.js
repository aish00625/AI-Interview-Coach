const { pool } = require('../config/db')
const model = require('../models/hirerApplicationModel')
const applicationModel = require('../models/applicationModel')
const resumeService = require('./resumeService')
const auditService = require('./auditService')
const scorecardService = require('./scorecardService')
const notificationService = require('./notificationService')
const { REJECTION_REASONS, REASON_CODES } = require('../utils/rejectionReasons')
const { can } = require('../utils/orgPermissions')

/** Statuses a hiring team may move an application to, from each current status. (withdrawn is the candidate's own action.) */
const HIRER_TRANSITIONS = {
  submitted: ['under_review', 'shortlisted', 'rejected'],
  under_review: ['shortlisted', 'rejected'],
  shortlisted: ['under_review', 'rejected', 'hired'],
  rejected: ['under_review'], // reconsider
  hired: [],
  withdrawn: [],
}
const MAX_COMPARE = 5

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

async function requireJob(organizationId, jobId) {
  const job = await model.getJobForOrg(jobId, organizationId)
  if (!job) throw httpError(404, 'Job not found.')
  return job
}

async function listApplicants({ organizationId, jobId, status, search, sort }) {
  const job = await requireJob(organizationId, jobId)
  const applicants = await model.listForJob(job.id, organizationId, { status: status || null, search: search ? String(search).trim() || null : null, sort })
  return { job, applicants }
}

async function requireApplication(organizationId, applicationId, client) {
  const app = await model.getScoped(applicationId, organizationId, client)
  if (!app) throw httpError(404, 'Application not found.')
  return app
}

/**
 * Full review view. Layers of restriction, all enforced here and in SQL (never in the UI):
 *   withdrawn         -> only the fact of the application and its history
 *   blind review      -> no name, e-mail, resume or cover note while the application is being screened
 *   no resume consent -> no resume or cover note
 *   no assessment consent -> no interview answers or code
 * Every time resume text or assessment data is returned an audit entry is written first (fail closed).
 */
async function getReview({ organizationId, applicationId, actorId, actorRole }) {
  const app = await requireApplication(organizationId, applicationId)
  const history = await model.getHistory(app.id)
  const base = {
    id: app.id, jobId: app.job_id, jobTitle: app.job_title, status: app.status, appliedAt: app.created_at, updatedAt: app.updated_at,
    blindReview: Boolean(app.blind_review), identityHidden: Boolean(app.is_masked),
  }
  if (app.status === 'withdrawn') {
    return { application: base, restricted: true, history: shapeHistory(history), allowedTransitions: [] }
  }
  const masked = Boolean(app.is_masked)
  const consentResume = app.consent_resume_at != null
  const consentAssessment = app.consent_assessment_at != null
  const [profile, notes, scorecards] = await Promise.all([
    model.getCandidateProfile(app.id, organizationId),
    model.getNotes(app.id),
    scorecardService.forActor({ application: app, actorId }),
  ])

  let resume = null
  if (consentResume && !masked) {
    const row = await model.getResumeForApplication(app.id, organizationId)
    if (row) {
      await auditService.record({ organizationId, actorId, applicationId: app.id, action: 'resume_view', detail: { resumeId: row.id } })
      resume = {
        filename: row.original_filename, contentType: row.content_type, sizeBytes: row.size_bytes,
        extractionStatus: row.extraction_status, text: row.extracted_text,
      }
    }
  }

  let interview = null
  let coding = null
  if (consentAssessment) {
    [interview, coding] = await Promise.all([model.getInterviewResult(app.id), model.getCodingResult(app.id, app.job_id)])
    const hasData = Boolean(interview) || (coding || []).some((c) => c.attemptCount > 0)
    if (hasData) await auditService.record({ organizationId, actorId, applicationId: app.id, action: 'assessment_view' })
  }

  return {
    application: { ...base, coverNote: consentResume && !masked ? app.cover_note : null },
    restricted: false,
    consent: { resume: consentResume, assessment: consentAssessment },
    withheld: {
      resume: resume ? null : (masked ? 'identity_hidden' : (!consentResume ? 'no_consent' : 'not_available')),
      assessment: consentAssessment ? null : 'no_consent',
    },
    candidate: {
      name: profile.name, email: profile.email, targetRole: profile.target_role, experienceLevel: profile.experience_level,
      preferredLanguage: profile.preferred_language, skills: profile.skills, requiredSkills: profile.required_skills,
    },
    resume,
    interview,
    coding: consentAssessment ? coding : [],
    history: shapeHistory(history),
    notes,
    scorecards,
    permissions: { decide: can(actorRole, 'decide'), review: can(actorRole, 'review') },
    allowedTransitions: can(actorRole, 'decide') ? (HIRER_TRANSITIONS[app.status] || []) : [],
    rejectionReasons: Object.fromEntries(REASON_CODES.map((c) => [c, { label: REJECTION_REASONS[c].label, requiresNote: REJECTION_REASONS[c].requiresNote }])),
  }
}

const shapeHistory = (rows) => rows.map((h) => ({ ...h, reason: h.reason_code && REJECTION_REASONS[h.reason_code] ? REJECTION_REASONS[h.reason_code].label : null }))

async function changeStatus({ organizationId, applicationId, userId, actorRole, status, note, reasonCode }) {
  const cleanNote = note ? String(note).trim() || null : null
  let reason = null
  if (status === 'rejected') {
    if (!reasonCode || !REJECTION_REASONS[reasonCode]) throw httpError(400, 'Choose a reason for rejecting this application.')
    if (REJECTION_REASONS[reasonCode].requiresNote && (!cleanNote || cleanNote.length < 10)) {
      throw httpError(400, 'Add a short explanation (at least 10 characters) when the reason is "other".')
    }
    reason = reasonCode
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const app = await model.getScoped(applicationId, organizationId, client, { forUpdate: true })
    if (!app) throw httpError(404, 'Application not found.')
    if (app.status === status) throw httpError(409, `This application is already ${status.replace('_', ' ')}.`)
    if (!(HIRER_TRANSITIONS[app.status] || []).includes(status)) {
      throw httpError(409, `An application that is ${app.status.replace('_', ' ')} cannot be moved to ${status.replace('_', ' ')}.`)
    }
    if (!(await model.changeStatus({ applicationId: app.id, from: app.status, to: status }, client))) {
      throw httpError(409, 'The application was changed by someone else. Reload and try again.')
    }
    await applicationModel.addHistory({ applicationId: app.id, fromStatus: app.status, toStatus: status, changedBy: userId, note: cleanNote, reasonCode: reason }, client)
    await notificationService.notifyStatusChange({
      candidateId: app.candidate_id, applicationId: app.id, jobTitle: app.job_title, organizationName: app.organization_name,
      fromStatus: app.status, toStatus: status, reasonCode: reason,
    }, client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getReview({ organizationId, applicationId, actorId: userId, actorRole })
}

async function submitScorecard({ organizationId, applicationId, userId, recommendation, summary, ratings }) {
  const app = await requireApplication(organizationId, applicationId)
  if (app.status === 'withdrawn') throw httpError(409, 'This candidate has withdrawn their application.')
  return scorecardService.submit({ application: app, reviewerId: userId, recommendation, summary, ratings })
}

async function addNote({ organizationId, applicationId, userId, body }) {
  const app = await requireApplication(organizationId, applicationId)
  if (app.status === 'withdrawn') throw httpError(409, 'This candidate has withdrawn their application.')
  await model.addNote({ applicationId: app.id, authorId: userId, body: String(body).trim() })
  return model.getNotes(app.id)
}

async function openResume({ organizationId, applicationId, actorId }) {
  const app = await requireApplication(organizationId, applicationId)
  if (app.status === 'withdrawn') throw httpError(403, 'This candidate has withdrawn their application.')
  if (app.is_masked) throw httpError(403, 'This job uses blind review: the resume is hidden until the candidate is shortlisted.')
  if (app.consent_resume_at == null) throw httpError(403, 'The candidate has not yet agreed to share their resume with your organization.')
  const row = await model.getResumeForApplication(app.id, organizationId)
  if (!row) throw httpError(404, 'Resume not found.')
  await auditService.record({ organizationId, actorId, applicationId: app.id, action: 'resume_download', detail: { resumeId: row.id } })
  return resumeService.openResumeFile(row)
}

async function compare({ organizationId, jobId, ids, actorId }) {
  const job = await requireJob(organizationId, jobId)
  const unique = [...new Set(ids.map(Number))]
  if (unique.some((n) => !Number.isInteger(n) || n < 1)) throw httpError(400, 'ids must be positive integers.')
  if (unique.length < 2) throw httpError(400, 'Choose at least two candidates to compare.')
  if (unique.length > MAX_COMPARE) throw httpError(400, `You can compare at most ${MAX_COMPARE} candidates.`)
  const rows = await model.getComparisonRows(job.id, organizationId, unique)
  if (rows.length !== unique.length) throw httpError(404, 'One or more applications were not found for this job.')
  if (rows.some((r) => r.status === 'withdrawn')) throw httpError(409, 'Withdrawn applications cannot be compared.')
  for (const r of rows) {
    if (r.consent_assessment) await auditService.record({ organizationId, actorId, applicationId: r.id, action: 'comparison_view' })
  }
  return { job, candidates: rows }
}

const getDashboard = ({ organizationId }) => model.getDashboard(organizationId)

module.exports = { listApplicants, getReview, changeStatus, submitScorecard, addNote, openResume, compare, getDashboard, HIRER_TRANSITIONS, MAX_COMPARE }
