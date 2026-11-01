// Shared setup for Phase J tests: REAL route chains + REAL PostgreSQL (see tests/helpers/miniApp.js for what is stubbed).
const fs = require('fs'); const os = require('os'); const path = require('path')
const assert = require('node:assert/strict')
const test = require('node:test')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')
const { makeDocx } = require('../helpers/fixtures')

function setup(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `resumes-j-${label}-`))
  process.env.RESUME_STORAGE_DIR = dir
  const db = process.env.AIC_TEST_DB
  const pool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => { pool.closeAll(); fs.rmSync(dir, { recursive: true, force: true }) })
  stubModule(path.join(root, 'services/aiServiceClient'), {
    evaluateAnswer: async () => ({ technicalScore: 85, relevanceScore: 75, clarityScore: 65, completenessScore: 95, strengths: ['good'], weaknesses: ['brief'], suggestedImprovement: 's', modelAnswer: 'm' }),
  })
  stubModule(path.join(root, 'services/codeExecutorClient'), {
    executeCode: async ({ sourceCode }) => ({ status: 'completed', passedTests: sourceCode.includes('SOLVED') ? 3 : 1, totalTests: 3, tests: [], stderr: '', executionTimeMs: 12, memoryUsedKb: null }),
  })
  const { install } = require('../helpers/miniApp')
  const app = install(pool)
  const api = app.request
  const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.success, true); return r.body.data }
  let seq = 0
  const email = (l) => `${l}${tag}@j.test`
  const register = async (label, extra = {}) => ok(await api('POST', '/api/auth/register', { body: { name: `${label} User`, email: email(label), password: 'password123', ...extra } }), 201)
  const approve = (orgId) => pool.query("UPDATE organizations SET status = 'approved' WHERE id = $1", [orgId])

  /** Hirer organization (approved) + candidate who applied with resume and full consent. */
  async function hiringFixture({ blind = false, criteria } = {}) {
    const owner = await register(`owner${++seq}`, { role: 'hirer', companyName: `Org ${tag}` })
    await approve(owner.user.organization.id)
    const job = ok(await api('POST', '/api/hirer/jobs', { token: owner.token, body: { title: 'Backend Dev', description: 'Build.', experienceLevel: 'any', requiredSkills: [`Node${tag}`, `SQL${tag}`], blindReview: blind, scorecardCriteria: criteria } }), 201).job
    ok(await api('POST', `/api/hirer/jobs/${job.id}/status`, { token: owner.token, body: { status: 'open' } }))
    return { owner, job }
  }
  async function candidateApplies(job, label, { consentAssessment = true, cover = 'Hello team' } = {}) {
    const c = await register(`${label}${++seq}`)
    const r = ok(await api('POST', '/api/resumes', { token: c.token, file: { buffer: makeDocx([`${label} User`, 'Secret resume text']), originalname: `${label}.docx` } }), 201).resume
    const a = ok(await api('POST', '/api/applications', { token: c.token, body: { jobId: job.id, resumeId: r.id, coverNote: cover, consentShareResume: true, consentShareAssessment: consentAssessment } }), 201).application
    return { ...c, resume: r, app: a }
  }
  return { pool, api, ok, email, register, approve, tag, hiringFixture, candidateApplies, dir }
}
module.exports = { setup }
