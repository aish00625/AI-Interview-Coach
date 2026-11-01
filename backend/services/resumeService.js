const { pool } = require('../config/db')
const resumeModel = require('../models/resumeModel')
const storage = require('../utils/resumeStorage')
const { detectResumeType, extractResumeText, sanitizeFilename, TYPE_INFO } = require('../utils/resumeFile')

const MAX_RESUMES_PER_USER = Number(process.env.MAX_RESUMES_PER_USER) || 5

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

/** Validates by content, extracts text (non-fatal), writes the file with a random key, then records metadata atomically. */
async function uploadResume({ userId, file }) {
  const type = detectResumeType(file.buffer)
  if (!type) throw httpError(415, 'Unsupported file. Please upload a PDF or a DOCX (Word) resume.')
  const info = TYPE_INFO[type]
  const { status, text } = await extractResumeText(file.buffer, type)

  const client = await pool.connect()
  let storageKey = null
  try {
    await client.query('BEGIN')
    // Serialise concurrent uploads by the same user so the per-user cap can't be raced.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])
    if ((await resumeModel.countByUser(userId, client)) >= MAX_RESUMES_PER_USER) {
      throw httpError(409, `You can keep at most ${MAX_RESUMES_PER_USER} resumes. Delete an unused one first.`)
    }
    storageKey = await storage.saveFile(file.buffer, info.ext)
    const resume = await resumeModel.insertResume(
      {
        userId,
        originalFilename: sanitizeFilename(file.originalname, info.ext),
        contentType: info.contentType,
        sizeBytes: file.buffer.length,
        storageKey,
        extractedText: text,
        extractionStatus: status,
      },
      client,
    )
    await client.query('COMMIT')
    return resume
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (storageKey) await storage.deleteFileQuietly(storageKey)
    throw err
  } finally {
    client.release()
  }
}

const listResumes = (userId) => resumeModel.listByUser(userId)

async function getResume({ userId, resumeId }) {
  const resume = await resumeModel.getOwned(resumeId, userId, { withText: true })
  if (!resume) throw httpError(404, 'Resume not found.')
  const { storage_key, ...safe } = resume // storage_key is server-internal
  return safe
}

async function deleteResume({ userId, resumeId }) {
  const key = await resumeModel.deleteUnusedOwned(resumeId, userId)
  if (!key) {
    if (await resumeModel.getOwned(resumeId, userId)) throw httpError(409, 'This resume is attached to a job application and cannot be deleted.')
    throw httpError(404, 'Resume not found.')
  }
  await storage.deleteFileQuietly(key)
}

/** Removes stored files for keys whose rows are already gone (used after the database transaction that deleted them committed). */
async function purgeFiles(keys) {
  for (const key of keys) await storage.deleteFileQuietly(key)
}

/** Given a resume row the CALLER HAS ALREADY AUTHORIZED, returns what the controller needs to stream it. */
async function openResumeFile(row) {
  if (!(await storage.fileExists(row.storage_key))) throw httpError(404, 'The resume file is no longer available.')
  return { stream: storage.openReadStream(row.storage_key), filename: row.original_filename, contentType: row.content_type, size: row.size_bytes }
}

async function downloadOwnResume({ userId, resumeId }) {
  const row = await resumeModel.getOwned(resumeId, userId)
  if (!row) throw httpError(404, 'Resume not found.')
  return openResumeFile(row)
}

module.exports = { uploadResume, listResumes, getResume, deleteResume, purgeFiles, openResumeFile, downloadOwnResume, MAX_RESUMES_PER_USER }
