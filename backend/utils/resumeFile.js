const zlib = require('zlib')

/**
 * Content-based validation + text extraction for resume uploads.
 * The client-declared mimetype and filename are NEVER trusted: the file type is decided by its bytes.
 */

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_TEXT_CHARS = 100000
const PDF_TIMEOUT_MS = Number(process.env.PDF_PARSE_TIMEOUT_MS) || 10000
const MAX_DOCX_XML_BYTES = 20 * 1024 * 1024 // cap on inflated word/document.xml (zip-bomb guard)

/** Reads the ZIP central directory and returns [{ name, method, compSize, uncompSize, localOffset }]. */
function readZipEntries(buf) {
  const minEocd = 22
  const start = Math.max(0, buf.length - minEocd - 65535)
  let eocd = -1
  for (let i = buf.length - minEocd; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip archive')
  const total = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let n = 0; n < total && n < 5000; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt zip directory')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const uncompSize = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOffset = buf.readUInt32LE(off + 42)
    entries.push({ name: buf.toString('utf8', off + 46, off + 46 + nameLen), method, compSize, uncompSize, localOffset })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readZipEntry(buf, entry, maxBytes) {
  const o = entry.localOffset
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw new Error('corrupt zip entry')
  const dataStart = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28)
  const raw = buf.subarray(dataStart, dataStart + entry.compSize)
  if (entry.uncompSize > maxBytes) throw new Error('entry too large')
  if (entry.method === 0) return raw
  if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: maxBytes })
  throw new Error('unsupported zip compression')
}

/** Returns 'pdf' | 'docx' | null by inspecting the bytes. */
function detectResumeType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (buf.readUInt32LE(0) === 0x04034b50) {
    try {
      const names = readZipEntries(buf).map((e) => e.name)
      if (names.includes('[Content_Types].xml') && names.includes('word/document.xml')) return 'docx'
    } catch { /* not a valid docx */ }
  }
  return null
}

const TYPE_INFO = {
  pdf: { contentType: PDF_MIME, ext: 'pdf' },
  docx: { contentType: DOCX_MIME, ext: 'docx' },
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return XML_ENTITIES[e]
  })
}

function extractDocxText(buf) {
  const entry = readZipEntries(buf).find((e) => e.name === 'word/document.xml')
  if (!entry) throw new Error('word/document.xml missing')
  const xml = readZipEntry(buf, entry, MAX_DOCX_XML_BYTES).toString('utf8')
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text)
}

let pdfParser // undefined = not tried, null = unavailable
function loadPdfParser() {
  if (pdfParser === undefined) {
    try {
      // Direct lib path avoids pdf-parse's index.js debug block that reads a test file.
      pdfParser = require('pdf-parse/lib/pdf-parse.js')
    } catch {
      pdfParser = null
    }
  }
  return pdfParser
}

async function extractPdfText(buf) {
  const parse = loadPdfParser()
  if (!parse) return { status: 'unsupported', text: null }
  // First 15 pages is plenty for a resume; a hard time limit stops a pathological PDF from stalling the request.
  let timer
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('pdf parse timeout')), PDF_TIMEOUT_MS) })
  try {
    const result = await Promise.race([parse(buf, { max: 15 }), timeout])
    return { status: 'ok', text: result.text || '' }
  } finally {
    clearTimeout(timer)
  }
}

function cleanText(raw) {
  return String(raw)
    .replace(/\u0000/g, '')
    .replace(/[^\S\n\t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS)
}

/** Never throws: extraction problems must not block an upload. */
async function extractResumeText(buf, type) {
  try {
    let out
    if (type === 'docx') out = { status: 'ok', text: extractDocxText(buf) }
    else if (type === 'pdf') out = await extractPdfText(buf)
    else return { status: 'unsupported', text: null }
    if (out.status !== 'ok') return out
    const text = cleanText(out.text)
    return text ? { status: 'ok', text } : { status: 'empty', text: null }
  } catch {
    return { status: 'failed', text: null }
  }
}

/** Basename only, no control chars / path separators, bounded length. */
function sanitizeFilename(name, ext) {
  const base = String(name || '').split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .trim()
    .slice(0, 150)
  const safe = base && base !== '.' && base !== '..' ? base : 'resume'
  return /\.(pdf|docx)$/i.test(safe) ? safe : `${safe}.${ext}`
}

module.exports = { detectResumeType, extractResumeText, sanitizeFilename, TYPE_INFO, readZipEntries, MAX_TEXT_CHARS }
