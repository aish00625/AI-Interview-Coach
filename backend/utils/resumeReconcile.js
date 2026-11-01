const fs = require('fs')
const path = require('path')
const storage = require('./resumeStorage')

/**
 * Reconciles resume files on disk with the `resumes` table.
 *
 *  - orphan file : a stored file (valid key name) with no database row, e.g. left behind when an unlink failed
 *                  after its row was deleted, or the server crashed between writing the file and committing.
 *  - missing file: a row whose file is not on disk (restore from backup needed; nothing is deleted for these).
 *
 * Only files whose names match the server-generated key pattern are ever considered, and files younger than
 * `minAgeMs` are skipped so an upload that is still being committed is never removed.
 */
async function listStoredFiles() {
  let names
  try { names = await fs.promises.readdir(storage.storageDir()) } catch (err) { if (err.code === 'ENOENT') return []; throw err }
  const files = []
  for (const name of names) {
    if (!storage.KEY_PATTERN.test(name)) continue
    const st = await fs.promises.stat(path.join(storage.storageDir(), name)).catch(() => null)
    if (st && st.isFile()) files.push({ key: name, mtimeMs: st.mtimeMs })
  }
  return files
}

async function reconcile(pool, { minAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  const { rows } = await pool.query('SELECT storage_key FROM resumes')
  const known = new Set(rows.map((r) => r.storage_key))
  const files = await listStoredFiles()
  const onDisk = new Set(files.map((f) => f.key))
  return {
    orphans: files.filter((f) => !known.has(f.key) && now - f.mtimeMs >= minAgeMs).map((f) => f.key),
    tooRecentToJudge: files.filter((f) => !known.has(f.key) && now - f.mtimeMs < minAgeMs).map((f) => f.key),
    missing: [...known].filter((k) => !onDisk.has(k)),
    fileCount: files.length,
    rowCount: known.size,
  }
}

async function removeOrphans(keys) {
  let removed = 0
  for (const key of keys) { await storage.deleteFile(key); removed += 1 }
  return removed
}

module.exports = { reconcile, removeOrphans, listStoredFiles }
