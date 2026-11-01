// Builds the full list of HTTP routes [{ method, fullPath, guards }] by loading every route module under the recording
// express stub and joining each with the mount prefix found in app.js.
const fs = require('fs'); const path = require('path')
const probe = require('./routeProbe')
const { stubModule, root } = require('../phaseA/helpers')

function build() {
  probe.install()
  for (const lib of ['bcryptjs', 'jsonwebtoken', 'axios', 'dotenv', 'form-data', 'multer']) stubModule(lib, {})
  const marker = (g) => { const f = (req, res, next) => next(); f.guard = g; return f }
  stubModule(path.join(root, 'middleware/audioUpload'), { uploadAudio: { single: () => marker('upload-audio') }, requireAudioFile: marker('require-audio'), MAX_AUDIO_BYTES: 1 })
  stubModule(path.join(root, 'middleware/videoUpload'), { uploadVideo: { single: () => marker('upload-video') }, requireVideoFile: marker('require-video'), MAX_VIDEO_BYTES: 1 })
  stubModule(path.join(root, 'middleware/faceFrameUpload'), { uploadFaceFrame: { single: () => marker('upload-face-frame') }, requireFaceFrame: marker('require-face-frame'), MAX_FRAME_BYTES: 1 })
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
  const fileByVar = {}
  for (const m of app.matchAll(/const (\w+) = require\('\.\/routes\/(\w+)'\)/g)) fileByVar[m[1]] = m[2]
  const out = []
  for (const m of app.matchAll(/app\.use\('(\/api\/[^']*)',\s*(\w+)\)/g)) {
    const file = fileByVar[m[2]]
    if (!file) continue
    for (const r of probe.loadRoutes(`routes/${file}.js`)) {
      const p = r.path === '/' ? '' : r.path
      out.push({ method: r.method, fullPath: m[1] + p, guards: r.guards, file })
    }
  }
  return out
}
module.exports = { build }
