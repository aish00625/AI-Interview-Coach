const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')

stubModule('multer', Object.assign(() => ({ single: () => (q, r, n) => n() }), { memoryStorage: () => ({}) }))
const { requireFaceFrame, sniffImage } = require(path.join(root, 'middleware/faceFrameUpload'))
const { mockRes } = require('../phaseA/helpers')

const run = (req) => { const res = mockRes(); let called = false; requireFaceFrame(req, res, () => { called = true }); return { res, called } }

test('sniffImage recognises real image signatures only', () => {
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg')
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), 'image/png')
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)])), 'image/webp')
  assert.equal(sniffImage(Buffer.from('<?php echo 1; ?> padding padding')), null)
  assert.equal(sniffImage(Buffer.alloc(3)), null)
  assert.equal(sniffImage(null), null)
})

test('a missing, mislabelled or wrong-type frame is rejected before the AI service sees it', () => {
  assert.equal(run({}).res.statusCode, 400)
  assert.equal(run({ fileValidationError: 'Frames must be JPEG, PNG or WebP images.' }).res.statusCode, 415)
  const fake = run({ file: { buffer: Buffer.from('this is a script, not an image'), mimetype: 'image/jpeg' } })
  assert.equal(fake.res.statusCode, 415); assert.equal(fake.called, false)
  const good = run({ file: { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), mimetype: 'application/octet-stream' } })
  assert.equal(good.called, true)
})
