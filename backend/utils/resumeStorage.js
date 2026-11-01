const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/**
 * Resume files live on server disk in RESUME_STORAGE_DIR (default backend/storage/resumes) — a folder the app
 * never serves statically. Files are addressed ONLY by a server-generated random key, so a user-supplied
 * filename can never influence the path.
 */
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx)$/

function storageDir() {
  return path.resolve(process.env.RESUME_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'resumes'))
}

function resolveKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new Error('Invalid storage key.')
  const dir = storageDir()
  const full = path.resolve(dir, key)
  if (!full.startsWith(dir + path.sep)) throw new Error('Invalid storage path.')
  return full
}

async function saveFile(buffer, ext) {
  const key = `${crypto.randomUUID()}.${ext}`
  const full = resolveKey(key)
  await fs.promises.mkdir(path.dirname(full), { recursive: true })
  await fs.promises.writeFile(full, buffer, { flag: 'wx', mode: 0o600 })
  return key
}

function openReadStream(key) {
  return fs.createReadStream(resolveKey(key))
}

async function deleteFile(key) {
  try {
    await fs.promises.unlink(resolveKey(key))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

/** Best-effort delete that never throws and never hides a failure: logs the KEY (not the path or owner) so `scripts/reconcile-resumes.js` can finish the job. */
async function deleteFileQuietly(key) {
  try { await module.exports.deleteFile(key); return true } catch (err) {
    console.error(`Could not delete resume file ${key}: ${err.code || err.message}. Run scripts/reconcile-resumes.js to clean up.`)
    return false
  }
}

async function fileExists(key) {
  try { await fs.promises.access(resolveKey(key)); return true } catch { return false }
}

module.exports = { saveFile, openReadStream, deleteFile, deleteFileQuietly, fileExists, resolveKey, storageDir, KEY_PATTERN }
