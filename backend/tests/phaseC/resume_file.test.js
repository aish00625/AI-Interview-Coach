const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { stubModule, stubMissing, clearStub, root } = require('../phaseA/helpers')
const { makeZip, makeDocx, makePdf } = require('../helpers/fixtures')

const resumeFilePath = path.join(root, 'utils/resumeFile.js')
function freshResumeFile() { delete require.cache[resumeFilePath]; return require(resumeFilePath) }

test('detects PDF and real DOCX by content; rejects renamed/unsupported/garbage files', () => {
  const { detectResumeType } = freshResumeFile()
  assert.equal(detectResumeType(makePdf()), 'pdf')
  assert.equal(detectResumeType(makeDocx(['hi'])), 'docx')
  assert.equal(detectResumeType(makeZip([{ name: 'a.txt', data: 'x' }])), null, 'plain zip is not a docx')
  assert.equal(detectResumeType(makeZip([{ name: '[Content_Types].xml', data: '<x/>' }])), null, 'no word/document.xml')
  assert.equal(detectResumeType(Buffer.from('D0CF11E0A1B11AE1' + '00'.repeat(20), 'hex')), null, 'legacy .doc (OLE)')
  assert.equal(detectResumeType(Buffer.from('<?php system($_GET[0]); ?>')), null)
  assert.equal(detectResumeType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00')), null, 'exe')
  assert.equal(detectResumeType(Buffer.alloc(3)), null)
  assert.equal(detectResumeType(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(40, 1)])), null, 'truncated/corrupt zip')
})

test('DOCX text extraction: paragraphs, entities, tabs, unicode; stored and deflated entries', async () => {
  const { extractResumeText } = freshResumeFile()
  const out = await extractResumeText(makeDocx(['Aishu Gowda', 'Skills: C&amp;C++ &lt;3 &#x263A; &#9731;', 'Café ☕']), 'docx')
  assert.equal(out.status, 'ok')
  assert.equal(out.text, 'Aishu Gowda\nSkills: C&C++ <3 ☺ ☃\nCafé ☕')
  const stored = makeZip([{ name: '[Content_Types].xml', data: '<Types/>', deflate: false }, { name: 'word/document.xml', data: '<w:p><w:t>stored</w:t></w:p>', deflate: false }])
  assert.equal((await extractResumeText(stored, 'docx')).text, 'stored')
})

test('empty DOCX -> status empty; corrupt DOCX -> failed (never throws)', async () => {
  const { extractResumeText } = freshResumeFile()
  assert.deepEqual(await extractResumeText(makeDocx(['   ']), 'docx'), { status: 'empty', text: null })
  const corrupt = makeDocx(['x']); corrupt[corrupt.length - 30] ^= 0xff
  const r = await extractResumeText(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(50, 7)]), 'docx')
  assert.equal(r.status, 'failed')
  assert.ok(['ok', 'failed', 'empty'].includes((await extractResumeText(corrupt, 'docx')).status))
})

test('zip-bomb guard: oversized word/document.xml is refused (failed), not inflated', async () => {
  const { extractResumeText } = freshResumeFile()
  const huge = Buffer.alloc(30 * 1024 * 1024, 0x61) // compresses to ~30 KB
  const bomb = makeZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'word/document.xml', data: huge }])
  assert.ok(bomb.length < 200 * 1024)
  assert.equal((await extractResumeText(bomb, 'docx')).status, 'failed')
  // header lies about size but real data is bigger -> inflate cap still stops it
  const liar = makeZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'word/document.xml', data: huge, declaredUncompressed: 10 }])
  assert.equal((await extractResumeText(liar, 'docx')).status, 'failed')
})

test('extracted text is capped at 100k characters and cleaned', async () => {
  const { extractResumeText, MAX_TEXT_CHARS } = freshResumeFile()
  const big = await extractResumeText(makeDocx(['word '.repeat(60000)]), 'docx')
  assert.equal(big.text.length, MAX_TEXT_CHARS)
  const ws = await extractResumeText(makeDocx(['a   \u0000  b']), 'docx')
  assert.equal(ws.text, 'a b')
})

test('PDF: without pdf-parse installed -> unsupported (non-fatal)', async () => {
  // Simulate "package not installed" explicitly so the result does not depend on whether this machine ran npm install.
  stubMissing('pdf-parse/lib/pdf-parse.js')
  try {
    const { extractResumeText } = freshResumeFile()
    assert.deepEqual(await extractResumeText(makePdf(), 'pdf'), { status: 'unsupported', text: null })
  } finally { clearStub('pdf-parse/lib/pdf-parse.js'); freshResumeFile() }
})

test('PDF: with the real pdf-parse installed, an unparseable PDF is a genuine failure, not "unsupported"', async (t) => {
  let installed = true
  try { require.resolve('pdf-parse/lib/pdf-parse.js') } catch { installed = false }
  if (!installed) return t.skip('pdf-parse is not installed on this machine')
  const { extractResumeText } = freshResumeFile()
  const r = await extractResumeText(Buffer.from('%PDF-1.4\nthis is not a real pdf body'), 'pdf')
  assert.equal(r.text, null)
  assert.equal(r.status, 'failed')
})

test('PDF wrapper with a STUBBED pdf-parse (parser itself is not exercised here): ok / empty / failed', async () => {
  stubModule('pdf-parse/lib/pdf-parse.js', async () => ({ text: '  Jane Doe\n\n\n\nJava  Developer ' }))
  let m = freshResumeFile()
  assert.deepEqual(await m.extractResumeText(makePdf(), 'pdf'), { status: 'ok', text: 'Jane Doe\n\nJava Developer' })
  stubModule('pdf-parse/lib/pdf-parse.js', async () => ({ text: '  \n ' }))
  m = freshResumeFile()
  assert.equal((await m.extractResumeText(makePdf(), 'pdf')).status, 'empty')
  stubModule('pdf-parse/lib/pdf-parse.js', async () => { throw new Error('bad xref') })
  m = freshResumeFile()
  assert.equal((await m.extractResumeText(makePdf(), 'pdf')).status, 'failed')
  clearStub('pdf-parse/lib/pdf-parse.js')
})

test('a hung PDF parser cannot stall extraction: time limit -> failed', async () => {
  process.env.PDF_PARSE_TIMEOUT_MS = '50'
  stubModule('pdf-parse/lib/pdf-parse.js', () => new Promise(() => {}))
  const m = freshResumeFile()
  const t0 = Date.now()
  assert.equal((await m.extractResumeText(makePdf(), 'pdf')).status, 'failed')
  assert.ok(Date.now() - t0 < 2000)
  clearStub('pdf-parse/lib/pdf-parse.js'); delete process.env.PDF_PARSE_TIMEOUT_MS
})

test('sanitizeFilename strips paths/control chars and enforces extension', () => {
  const { sanitizeFilename } = freshResumeFile()
  assert.equal(sanitizeFilename('../../etc/passwd', 'pdf'), 'passwd.pdf')
  assert.equal(sanitizeFilename('C:\\Users\\x\\My CV.docx', 'docx'), 'My CV.docx')
  assert.equal(sanitizeFilename('a\r\nb"c.pdf', 'pdf'), 'abc.pdf')
  assert.equal(sanitizeFilename('', 'pdf'), 'resume.pdf')
  assert.equal(sanitizeFilename('..', 'docx'), 'resume.docx')
  assert.ok(sanitizeFilename('x'.repeat(500), 'pdf').length <= 155)
})

test('Content-Disposition cannot be header-injected', () => {
  const { attachment } = require(path.join(root, 'utils/contentDisposition.js'))
  const h = attachment('evil"\r\nSet-Cookie: a=b; é.pdf')
  assert.equal(/[\r\n]/.test(h), false)
  assert.match(h, /^attachment; filename="[^"]*"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/)
})

test('storage: random keys, traversal-proof, round trip, delete idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumes-'))
  process.env.RESUME_STORAGE_DIR = dir
  const st = require(path.join(root, 'utils/resumeStorage.js'))
  for (const bad of ['../x.pdf', '..\\x.pdf', '/etc/passwd', 'a.pdf', '00000000-0000-0000-0000-000000000000.exe', '00000000-0000-0000-0000-000000000000.pdf/../../x', '', null, undefined, 5]) {
    assert.throws(() => st.resolveKey(bad), undefined, String(bad))
  }
  const key = await st.saveFile(Buffer.from('%PDF-1.4 test'), 'pdf')
  assert.match(key, st.KEY_PATTERN)
  assert.ok((await st.fileExists(key)))
  if (process.platform === 'win32') {
    // Windows does not expose POSIX group/other bits (stat reports 0o666 for writable files), so this check cannot be
    // made there; access is controlled by NTFS ACLs inherited from the storage directory. Enforced on Linux/macOS below.
  } else {
    assert.equal(fs.statSync(path.join(dir, key)).mode & 0o077, 0, 'owner-only permissions')
  }
  const chunks = []; for await (const c of st.openReadStream(key)) chunks.push(c)
  assert.equal(Buffer.concat(chunks).toString(), '%PDF-1.4 test')
  await st.deleteFile(key); await st.deleteFile(key)
  assert.equal(await st.fileExists(key), false)
  fs.rmSync(dir, { recursive: true })
})
