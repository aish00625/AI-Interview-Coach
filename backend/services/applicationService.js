const { pool } = require('../config/db')
const jobModel = require('../models/jobModel')
const resumeModel = require('../models/resumeModel')
const applicationModel = require('../models/applicationModel')
const assessmentService = require('./assessmentService')
const { labelFor } = require('../utils/rejectionReasons')
const auditService = require('./auditService')

// Bump when the wording shown to candidates at the consent step changes. Stored with each consent.
const CONSENT_VERSION = 'v1-2026-10'

const CANDIDATE_WITHDRAWABLE = ['submitted', 'under_review', 'shortlisted']

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

async function apply({ candidateId, jobId, resumeId, coverNote, consentShareResume, consentShareAssessment }) {
  if (consentShareResume !== true) {
    throw httpError(400, 'To apply you must agree to share your resume and profile with the hiring team.')
  }
  const consent = { consentResume: true, consentAssessment: consentShareAssessment === true, consentVersion: CONSENT_VERSION }
  const job = await jobModel.getOpenJob(jobId)
  if (!job) throw httpError(404, 'This job is not open for applications.')

  // Eligibility that the platform can verify objectively (free-text criteria are for the candidate to read).
  if (job.experience_level !== 'any') {
    const level = await applicationModel.getCandidateExperienceLevel(candidateId)
    if (level !== job.experience_level) {
      const wanted = job.experience_level === 'fresher' ? 'freshers' : 'experienced candidates'
      throw httpError(422, `This job is open to ${wanted} only. You can update your experience level on your Profile page.`)
    }
  }

  const resume = await resumeModel.getOwned(resumeId, candidateId)
  if (!resume) throw httpError(404, 'Resume not found.') // also covers "someone else's resume"

  const note = coverNote ? String(coverNote).trim() || null : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await applicationModel.findByJobAndCandidate(job.id, candidateId, client, { forUpdate: true })
    let applicationId
    if (existing) {
      if (existing.status !== 'withdrawn') throw httpError(409, 'You have already applied to this job.')
      await applicationModel.reactivate({ id: existing.id, resumeId: resume.id, coverNote: note, ...consent }, client)
      await applicationModel.addHistory({ applicationId: existing.id, fromStatus: 'withdrawn', toStatus: 'submitted', changedBy: candidateId, note: 'Re-applied' }, client)
      applicationId = existing.id
    } else {
      applicationId = await applicationModel.insertApplication({ jobId: job.id, candidateId, resumeId: resume.id, coverNote: note, ...consent }, client)
      await applicationModel.addHistory({ applicationId, fromStatus: null, toStatus: 'submitted', changedBy: candidateId }, client)
    }
    await client.query('COMMIT')
    return shapeForCandidate(await applicationModel.getForCandidate(applicationId, candidateId))
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

const listMine = async (candidateId) => (await applicationModel.listForCandidate(candidateId)).map((a) => ({
  ...a, consent: { resume: a.consent_resume_at != null, assessment: a.consent_assessment_at != null },
}))

/** The candidate can grant (never silently revoke) consent after applying; withdrawing the application ends sharing. */
async function recordConsent({ candidateId, applicationId, resume, assessment }) {
  if (resume !== true && assessment !== true) throw httpError(400, 'Nothing to consent to. Send resume: true and/or assessment: true.')
  const app = await applicationModel.getByIdForCandidate(applicationId, candidateId)
  if (!app) throw httpError(404, 'Application not found.')
  if (app.status === 'withdrawn') throw httpError(409, 'This application was withdrawn.')
  await applicationModel.grantConsent({ id: app.id, candidateId, resume: resume === true, assessment: assessment === true, version: CONSENT_VERSION })
  return getMine({ candidateId, applicationId })
}

async function accessLog({ candidateId, applicationId }) {
  const app = await applicationModel.getForCandidate(applicationId, candidateId)
  if (!app) throw httpError(404, 'Application not found.')
  return auditService.listForCandidate({ applicationId: app.id, candidateId, organizationName: app.organization_name })
}

const shapeForCandidate = (app) => ({
  ...app,
  consent: { resume: app.consent_resume_at != null, assessment: app.consent_assessment_at != null, version: app.consent_version, resumeAt: app.consent_resume_at, assessmentAt: app.consent_assessment_at },
  history: (app.history || []).map((h) => ({ ...h, reason: h.reason_code ? labelFor(h.reason_code) : null })),
})

async function getMine({ candidateId, applicationId }) {
  const app = await applicationModel.getForCandidate(applicationId, candidateId)
  if (!app) throw httpError(404, 'Application not found.')
  return { ...shapeForCandidate(app), assessment: await assessmentService.getCandidateProgress({ applicationId: app.id, jobId: app.job_id }) }
}

async function withdraw({ candidateId, applicationId }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const app = await applicationModel.getByIdForCandidate(applicationId, candidateId, client)
    if (!app) throw httpError(404, 'Application not found.')
    const moved = await applicationModel.transition({ id: app.id, from: CANDIDATE_WITHDRAWABLE, to: 'withdrawn' }, client)
    if (!moved) throw httpError(409, `An application that is ${app.status} cannot be withdrawn.`)
    await applicationModel.addHistory({ applicationId: app.id, fromStatus: app.status, toStatus: 'withdrawn', changedBy: candidateId }, client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getMine({ candidateId, applicationId })
}

module.exports = { apply, listMine, getMine, withdraw, recordConsent, accessLog, CANDIDATE_WITHDRAWABLE, CONSENT_VERSION }
