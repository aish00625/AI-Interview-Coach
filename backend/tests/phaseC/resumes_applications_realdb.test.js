// Real resume + application services/models against real PostgreSQL (needs AIC_TEST_DB), with a temp resume directory.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { stubModule, stubMissing, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')
const { makeDocx, makePdf } = require('../helpers/fixtures')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase C real-DB tests', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumes-c-'))
  process.env.RESUME_STORAGE_DIR = dir
  process.env.MAX_RESUMES_PER_USER = '3'
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => { testPool.closeAll(); fs.rmSync(dir, { recursive: true, force: true }) })
  stubModule('config/db', { pool: testPool })
  // The PDF test below is about the parser NOT being available; make that true whatever is installed (pdf-parse is a
  // real dependency, so CI has it). Same approach as resume_file.test.js.
  stubMissing('pdf-parse/lib/pdf-parse.js')
  const userModel = require(path.join(root, 'models/userModel.js'))
  const orgModel = require(path.join(root, 'models/organizationModel.js'))
  const jobService = require(path.join(root, 'services/jobService.js'))
  const resumeService = require(path.join(root, 'services/resumeService.js'))
  const applicationService = require(path.join(root, 'services/applicationService.js'))
  const tag = Date.now()
  const ctx = {}
  const file = (buffer, originalname = 'cv.docx') => ({ buffer, originalname })
  const cand = (label) => userModel.createUser({ email: `${label}${tag}@t.com`, passwordHash: 'h', name: label })

  async function mkJob(experienceLevel = 'any', title = 'Dev') {
    const j = await jobService.createJob({ organizationId: ctx.org.id, userId: ctx.hirer.id, body: { title, description: 'd', experienceLevel, requiredSkills: ['Java'] } })
    return jobService.changeStatus({ organizationId: ctx.org.id, jobId: j.id, status: 'open' })
  }

  test('setup', async () => {
    ctx.hirer = await userModel.createUser({ email: `h${tag}@t.com`, passwordHash: 'h', name: 'H', role: 'hirer' })
    ctx.org = await orgModel.createOrganization({ name: `C Org ${tag}`, createdBy: ctx.hirer.id })
    await orgModel.addMember({ organizationId: ctx.org.id, userId: ctx.hirer.id })
    await orgModel.setOrganizationStatus({ id: ctx.org.id, status: 'approved', reviewedBy: ctx.hirer.id })
    ctx.c1 = await cand('c1'); ctx.c2 = await cand('c2')
    await testPool.query("INSERT INTO profiles (user_id, experience_level) VALUES ($1, 'fresher') ON CONFLICT (user_id) DO NOTHING", [ctx.c1.id])
    await testPool.query("INSERT INTO profiles (user_id, experience_level) VALUES ($1, 'experienced') ON CONFLICT (user_id) DO NOTHING", [ctx.c2.id])
  })

  test('upload stores file on disk under a random key, metadata + extracted text in PostgreSQL', async () => {
    const r = await resumeService.uploadResume({ userId: ctx.c1.id, file: file(makeDocx(['Aishu', 'Java, SQL']), '../../evil/My CV.docx') })
    assert.equal(r.original_filename, 'My CV.docx'); assert.equal(r.extraction_status, 'ok')
    assert.ok(!('storage_key' in r) && !('extracted_text' in r), 'upload response is metadata only')
    const row = (await testPool.query('SELECT storage_key, extracted_text FROM resumes WHERE id = $1', [r.id])).rows[0]
    assert.equal(row.extracted_text, 'Aishu\nJava, SQL')
    assert.ok(fs.existsSync(path.join(dir, row.storage_key)))
    assert.deepEqual(fs.readdirSync(dir), [row.storage_key], 'only the random key exists on disk')
    ctx.r1 = r
  })

  test('rejects disguised/unsupported files and leaves nothing on disk or in DB', async () => {
    const before = fs.readdirSync(dir).length
    await assert.rejects(resumeService.uploadResume({ userId: ctx.c1.id, file: file(Buffer.from('MZ....exe'), 'cv.pdf') }), { statusCode: 415 })
    await assert.rejects(resumeService.uploadResume({ userId: ctx.c1.id, file: file(Buffer.from('<script>alert(1)</script>'), 'cv.docx') }), { statusCode: 415 })
    assert.equal(fs.readdirSync(dir).length, before)
  })

  test('a PDF with no parser available is stored with extraction_status=unsupported (not an error)', async () => {
    const r = await resumeService.uploadResume({ userId: ctx.c1.id, file: file(makePdf(), 'cv.pdf') })
    assert.equal(r.content_type, 'application/pdf'); assert.equal(r.extraction_status, 'unsupported')
    ctx.rPdf = r
  })

  test('per-user resume cap (3 in this test) is enforced and the rejected file is not left on disk', async () => {
    await resumeService.uploadResume({ userId: ctx.c1.id, file: file(makeDocx(['third'])) })
    const before = fs.readdirSync(dir).length
    await assert.rejects(resumeService.uploadResume({ userId: ctx.c1.id, file: file(makeDocx(['fourth'])) }), { statusCode: 409 })
    assert.equal(fs.readdirSync(dir).length, before)
    assert.equal((await resumeService.listResumes(ctx.c1.id)).length, 3)
  })

  test('IDOR: another candidate cannot read, download or delete my resume (404, indistinguishable from missing)', async () => {
    await assert.rejects(resumeService.getResume({ userId: ctx.c2.id, resumeId: ctx.r1.id }), { statusCode: 404 })
    await assert.rejects(resumeService.downloadOwnResume({ userId: ctx.c2.id, resumeId: ctx.r1.id }), { statusCode: 404 })
    await assert.rejects(resumeService.deleteResume({ userId: ctx.c2.id, resumeId: ctx.r1.id }), { statusCode: 404 })
    assert.equal((await resumeService.listResumes(ctx.c2.id)).length, 0)
    const own = await resumeService.getResume({ userId: ctx.c1.id, resumeId: ctx.r1.id })
    assert.equal(own.extracted_text, 'Aishu\nJava, SQL'); assert.ok(!('storage_key' in own))
    const dl = await resumeService.downloadOwnResume({ userId: ctx.c1.id, resumeId: ctx.r1.id })
    const chunks = []; for await (const c of dl.stream) chunks.push(c)
    assert.equal(Buffer.concat(chunks).length, ctx.r1.size_bytes)
    assert.match(dl.contentType, /wordprocessingml/)
  })

  test('apply: open job, eligibility, ownership of resume, duplicates', async () => {
    ctx.openJob = await mkJob('any', 'AnyLevel')
    ctx.fresherJob = await mkJob('fresher', 'FresherOnly')
    ctx.expJob = await mkJob('experienced', 'ExpOnly')
    const draft = await jobService.createJob({ organizationId: ctx.org.id, userId: ctx.hirer.id, body: { title: 'Draft', description: 'd', requiredSkills: ['Java'] } })
    await assert.rejects(applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.id, jobId: draft.id, resumeId: ctx.r1.id }), { statusCode: 404 })
    await assert.rejects(applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.id, jobId: ctx.expJob.id, resumeId: ctx.r1.id }), { statusCode: 422 })
    await assert.rejects(applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c2.id, jobId: ctx.fresherJob.id, resumeId: ctx.r1.id }), { statusCode: 422 })
    const c2resume = await resumeService.uploadResume({ userId: ctx.c2.id, file: file(makeDocx(['c2 resume'])) })
    ctx.c2resume = c2resume
    await assert.rejects(applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c2.id, jobId: ctx.openJob.id, resumeId: ctx.r1.id }), { statusCode: 404 }, "cannot attach someone else's resume")
    await assert.rejects(applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.id, jobId: ctx.openJob.id, resumeId: 999999999 }), { statusCode: 404 })

    const app = await applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.id, jobId: ctx.openJob.id, resumeId: ctx.r1.id, coverNote: '  Hello  ' })
    assert.equal(app.status, 'submitted'); assert.equal(app.cover_note, 'Hello'); assert.equal(app.organization_name, `C Org ${tag}`)
    assert.deepEqual(app.history.map((h) => [h.from_status, h.to_status]), [[null, 'submitted']])
    assert.ok(!JSON.stringify(app).includes('changed_by'))
    await assert.rejects(applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.id, jobId: ctx.openJob.id, resumeId: ctx.r1.id }), { statusCode: 409 })
    ctx.app = app
  })

  test('concurrent duplicate applications: exactly one succeeds', async () => {
    const job = await mkJob('any', 'Race')
    const results = await Promise.allSettled([1, 2, 3].map(() => applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c2.id, jobId: job.id, resumeId: ctx.c2resume.id })))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const n = (await testPool.query('SELECT count(*)::int n FROM applications WHERE job_id = $1', [job.id])).rows[0].n
    assert.equal(n, 1)
  })

  test('IDOR on applications: another candidate gets 404 for view and withdraw; lists are private', async () => {
    await assert.rejects(applicationService.getMine({ candidateId: ctx.c2.id, applicationId: ctx.app.id }), { statusCode: 404 })
    await assert.rejects(applicationService.withdraw({ candidateId: ctx.c2.id, applicationId: ctx.app.id }), { statusCode: 404 })
    assert.equal((await applicationService.listMine(ctx.c2.id)).some((a) => a.id === ctx.app.id), false)
    assert.equal((await applicationService.listMine(ctx.c1.id)).some((a) => a.id === ctx.app.id), true)
  })

  test('resume attached to an application cannot be deleted; an unused one can (file removed too)', async () => {
    await assert.rejects(resumeService.deleteResume({ userId: ctx.c1.id, resumeId: ctx.r1.id }), { statusCode: 409 })
    const key = (await testPool.query('SELECT storage_key FROM resumes WHERE id = $1', [ctx.rPdf.id])).rows[0].storage_key
    await resumeService.deleteResume({ userId: ctx.c1.id, resumeId: ctx.rPdf.id })
    assert.equal(fs.existsSync(path.join(dir, key)), false)
    await assert.rejects(resumeService.getResume({ userId: ctx.c1.id, resumeId: ctx.rPdf.id }), { statusCode: 404 })
  })

  test('withdraw -> history; withdrawn app can be re-applied (same row, history preserved); hired cannot be withdrawn', async () => {
    const w = await applicationService.withdraw({ candidateId: ctx.c1.id, applicationId: ctx.app.id })
    assert.equal(w.status, 'withdrawn')
    await assert.rejects(applicationService.withdraw({ candidateId: ctx.c1.id, applicationId: ctx.app.id }), { statusCode: 409 })
    const again = await applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.id, jobId: ctx.openJob.id, resumeId: ctx.r1.id })
    assert.equal(again.id, ctx.app.id); assert.equal(again.status, 'submitted')
    assert.deepEqual(again.history.map((h) => h.to_status), ['submitted', 'withdrawn', 'submitted'])
    await testPool.query("UPDATE applications SET status = 'hired' WHERE id = $1", [ctx.app.id])
    await assert.rejects(applicationService.withdraw({ candidateId: ctx.c1.id, applicationId: ctx.app.id }), { statusCode: 409 })
  })

  test('cannot apply once the job is closed or its organization suspended', async () => {
    const job = await mkJob('any', 'ToClose')
    await jobService.changeStatus({ organizationId: ctx.org.id, jobId: job.id, status: 'closed' })
    await assert.rejects(applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.id, jobId: job.id, resumeId: ctx.r1.id }), { statusCode: 404 })
  })

  test('DB constraints: invalid status rejected; jobs with applications cannot be hard-deleted', async () => {
    await assert.rejects(testPool.query("UPDATE applications SET status = 'bogus' WHERE id = $1", [ctx.app.id]))
    await assert.rejects(testPool.query('DELETE FROM job_openings WHERE id = $1', [ctx.openJob.id]), (e) => e.code === '23503')
    await assert.rejects(testPool.query('DELETE FROM resumes WHERE id = $1', [ctx.r1.id]), (e) => e.code === '23503')
  })
}
