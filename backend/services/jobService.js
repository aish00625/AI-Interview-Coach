const { pool } = require('../config/db')
const jobModel = require('../models/jobModel')
const { normalizeCriteria } = require('../utils/scorecard')
const skillModel = require('../models/skillModel')
const { canonicalSkillName } = require('../utils/skillSynonyms')

const JOB_STATUS_TRANSITIONS = {
  draft: ['open', 'closed'],
  open: ['closed'],
  closed: ['open'],
}
const MAX_SKILLS = 20

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

/** Canonicalises ("ReactJS" -> "React"), drops blanks, de-duplicates case-insensitively, caps the count. */
function normalizeSkillInputs(requiredSkills = []) {
  const seen = new Map()
  for (const entry of requiredSkills) {
    const name = canonicalSkillName(String(typeof entry === 'string' ? entry : entry?.name ?? '')).slice(0, 100)
    if (!name) continue
    const key = name.toLowerCase()
    if (!seen.has(key)) seen.set(key, { name, mandatory: typeof entry === 'string' ? true : entry.mandatory !== false })
  }
  const list = [...seen.values()]
  if (list.length > MAX_SKILLS) throw httpError(400, `A job can list at most ${MAX_SKILLS} required skills.`)
  return list
}

async function resolveSkills(client, requiredSkills) {
  const normalized = normalizeSkillInputs(requiredSkills)
  if (!normalized.length) return []
  const skills = await skillModel.findOrCreateSkillsByNames(normalized.map((s) => s.name), client)
  return skills.map((skill, i) => ({ skillId: skill.id, mandatory: normalized[i].mandatory }))
}

function parseClosesAt(value) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw httpError(400, 'closesAt must be a valid date.')
  return d.toISOString()
}

/** Create a DRAFT job and its required skills atomically. organizationId/userId come from the authenticated request, never the body. */
async function createJob({ organizationId, userId, body }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const jobId = await jobModel.createJob(
      {
        organizationId, createdBy: userId,
        title: body.title.trim(), description: body.description.trim(),
        location: body.location?.trim() || null,
        employmentType: body.employmentType, experienceLevel: body.experienceLevel,
        eligibilityCriteria: body.eligibilityCriteria?.trim() || null,
        closesAt: parseClosesAt(body.closesAt) ?? null,
        blindReview: body.blindReview === undefined ? undefined : Boolean(body.blindReview),
        scorecardCriteria: normalizeCriteria(body.scorecardCriteria),
      },
      client,
    )
    await jobModel.replaceJobSkills(jobId, await resolveSkills(client, body.requiredSkills), client)
    await client.query('COMMIT')
    return jobModel.getJobForOrg(jobId, organizationId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function updateJob({ organizationId, jobId, body }) {
  const fields = {}
  if (body.title !== undefined) fields.title = body.title.trim()
  if (body.description !== undefined) fields.description = body.description.trim()
  if ('location' in body) fields.location = body.location?.trim() || null
  if (body.employmentType !== undefined) fields.employmentType = body.employmentType
  if (body.experienceLevel !== undefined) fields.experienceLevel = body.experienceLevel
  if ('eligibilityCriteria' in body) fields.eligibilityCriteria = body.eligibilityCriteria?.trim() || null
  if ('closesAt' in body) fields.closesAt = parseClosesAt(body.closesAt)
  if (body.blindReview !== undefined) fields.blindReview = Boolean(body.blindReview)
  if ('scorecardCriteria' in body) fields.scorecardCriteria = normalizeCriteria(body.scorecardCriteria)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const updatedId = await jobModel.updateJob(jobId, organizationId, fields, client)
    if (!updatedId) {
      await client.query('ROLLBACK')
      throw httpError(404, 'Job not found.')
    }
    if (body.requiredSkills !== undefined) {
      await jobModel.replaceJobSkills(jobId, await resolveSkills(client, body.requiredSkills), client)
    }
    await client.query('COMMIT')
  } catch (err) {
    if (err.statusCode !== 404) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return jobModel.getJobForOrg(jobId, organizationId)
}

async function getJob({ organizationId, jobId }) {
  const job = await jobModel.getJobForOrg(jobId, organizationId)
  if (!job) throw httpError(404, 'Job not found.')
  return job
}

async function listJobs({ organizationId, status }) {
  return jobModel.listJobsForOrg(organizationId, { status: status || null })
}

async function changeStatus({ organizationId, jobId, status }) {
  const job = await jobModel.getJobForOrg(jobId, organizationId)
  if (!job) throw httpError(404, 'Job not found.')
  if (job.status === status) return job
  if (!JOB_STATUS_TRANSITIONS[job.status].includes(status)) {
    throw httpError(409, `A ${job.status} job cannot be changed to ${status}.`)
  }
  if (status === 'open' && (!job.required_skills || job.required_skills.length === 0)) {
    throw httpError(422, 'Add at least one required skill before publishing this job.')
  }
  await jobModel.setJobStatus(jobId, organizationId, status)
  return jobModel.getJobForOrg(jobId, organizationId)
}

async function deleteJob({ organizationId, jobId }) {
  const job = await jobModel.getJobForOrg(jobId, organizationId)
  if (!job) throw httpError(404, 'Job not found.')
  if (job.status !== 'draft') throw httpError(409, 'Only draft jobs can be deleted. Close the job instead.')
  const deleted = await jobModel.deleteDraftJob(jobId, organizationId)
  if (!deleted) throw httpError(409, 'This job can no longer be deleted.')
}

/* ---------------- candidate-facing ---------------- */

async function listOpenJobs({ search, page = 1, limit = 20 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const offset = (Math.max(Number(page) || 1, 1) - 1) * safeLimit
  return jobModel.listOpenJobs({ search: search || null, limit: safeLimit, offset })
}

async function getOpenJob(jobId) {
  const job = await jobModel.getOpenJob(jobId)
  if (!job) throw httpError(404, 'Job not found.')
  return job
}

module.exports = {
  createJob, updateJob, getJob, listJobs, changeStatus, deleteJob, listOpenJobs, getOpenJob,
  normalizeSkillInputs, JOB_STATUS_TRANSITIONS,
}
