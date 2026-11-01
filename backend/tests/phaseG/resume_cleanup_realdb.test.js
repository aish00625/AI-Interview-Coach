// Phase G: resume files must not be orphaned when a resume row goes away, and leftovers can be found and removed safely.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')
const { makeDocx } = require('../helpers/fixtures')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase G resume cleanup', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumes-gc-'))
  process.env.RESUME_STORAGE_DIR = dir
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => { testPool.closeAll(); fs.rmSync(dir, { recursive: true, force: true }) })
  stubModule('config/db', { pool: testPool })
  const userModel = require(path.join(root, 'models/userModel.js'))
  const resumeService = require(path.join(root, 'services/resumeService.js'))
  const storage = require(path.join(root, 'utils/resumeStorage.js'))
  const { reconcile, removeOrphans } = require(path.join(root, 'utils/resumeReconcile.js'))
  const tag = Date.now(); const S = {}
  const upload = (userId, text = 'x') => resumeService.uploadResume({ userId, file: { buffer: makeDocx([text]), originalname: 'cv.docx' } })
  const keyOf = async (id) => (await testPool.query('SELECT storage_key FROM resumes WHERE id = $1', [id])).rows[0].storage_key
  const age = (key, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(path.join(dir, key), t, t) }

  test('setup', async () => { S.u = await userModel.createUser({ email: `gc${tag}@t.com`, passwordHash: 'h', name: 'GC' }) })

  test('deleting a resume removes its row AND its file', async () => {
    const r = await upload(S.u.id, 'one'); const key = await keyOf(r.id)
    assert.ok(fs.existsSync(path.join(dir, key)))
    await resumeService.deleteResume({ userId: S.u.id, resumeId: r.id })
    assert.equal(fs.existsSync(path.join(dir, key)), false)
    assert.equal((await testPool.query('SELECT 1 FROM resumes WHERE id = $1', [r.id])).rows.length, 0)
  })

  test('a failing file delete does not fail the request, is logged by key only, and is later found as an orphan', async () => {
    const r = await upload(S.u.id, 'two'); const key = await keyOf(r.id)
    const real = storage.deleteFile; const errs = []; const realErr = console.error
    storage.deleteFile = async () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e }
    console.error = (...a) => errs.push(a.join(' '))
    try { await resumeService.deleteResume({ userId: S.u.id, resumeId: r.id }) } finally { storage.deleteFile = real; console.error = realErr }
    assert.equal((await testPool.query('SELECT 1 FROM resumes WHERE id = $1', [r.id])).rows.length, 0, 'row is gone')
    assert.ok(fs.existsSync(path.join(dir, key)), 'file left behind by the simulated failure')
    assert.ok(errs.some((m) => m.includes(key) && m.includes('reconcile-resumes')), 'failure is logged with the key and the remedy')
    assert.ok(!errs.some((m) => m.includes(dir)), 'the storage path is not logged')
    age(key, 2 * 3600 * 1000)
    const rep = await reconcile(testPool)
    assert.deepEqual(rep.orphans, [key])
    ctxKey = key
  })
  let ctxKey

  test('reconcile: recent files are not judged, files with rows are never orphans, foreign names are ignored, missing files are reported', async () => {
    const kept = await upload(S.u.id, 'kept'); const keptKey = await keyOf(kept.id); age(keptKey, 5 * 3600 * 1000)
    const recentKey = await storage.saveFile(Buffer.from('%PDF-1.4 recent'), 'pdf') // no row, brand new: may be an upload still committing
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a resume key')
    const missing = await upload(S.u.id, 'gone'); const missingKey = await keyOf(missing.id); fs.unlinkSync(path.join(dir, missingKey))
    const rep = await reconcile(testPool)
    assert.deepEqual(rep.orphans, [ctxKey])
    assert.deepEqual(rep.tooRecentToJudge, [recentKey])
    assert.ok(!rep.orphans.includes(keptKey)); assert.ok(rep.missing.includes(missingKey))
    assert.ok(fs.existsSync(path.join(dir, 'notes.txt')))
    assert.equal(await removeOrphans(rep.orphans), 1)
    assert.equal(fs.existsSync(path.join(dir, ctxKey)), false)
    assert.ok(fs.existsSync(path.join(dir, keptKey)) && fs.existsSync(path.join(dir, recentKey)) && fs.existsSync(path.join(dir, 'notes.txt')))
  })

  test('a resume attached to an application is never deleted (row or file); purgeFiles only touches the keys it is given', async () => {
    const r = await upload(S.u.id, 'attached'); const key = await keyOf(r.id)
    const hirer = await userModel.createUser({ email: `gch${tag}@t.com`, passwordHash: 'h', name: 'H', role: 'hirer' })
    const org = (await testPool.query("INSERT INTO organizations (name, status, created_by) VALUES ($1, 'approved', $2) RETURNING id", [`GC Org ${tag}`, hirer.id])).rows[0]
    const job = (await testPool.query("INSERT INTO job_openings (organization_id, created_by, title, description, status) VALUES ($1, $2, 'J', 'd', 'open') RETURNING id", [org.id, hirer.id])).rows[0]
    await testPool.query('INSERT INTO applications (job_id, candidate_id, resume_id) VALUES ($1, $2, $3)', [job.id, S.u.id, r.id])
    await assert.rejects(resumeService.deleteResume({ userId: S.u.id, resumeId: r.id }), { statusCode: 409 })
    assert.ok(fs.existsSync(path.join(dir, key)))
    const other = await storage.saveFile(Buffer.from('%PDF-1.4 other'), 'pdf')
    await resumeService.purgeFiles([other])
    assert.equal(fs.existsSync(path.join(dir, other)), false); assert.ok(fs.existsSync(path.join(dir, key)))
  })
}
