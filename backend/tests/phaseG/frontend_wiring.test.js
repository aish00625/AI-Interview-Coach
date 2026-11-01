// Phase G: static checks that would have caught "Profile page never calls the backend" and "History page imports mock data".
// Operates on frontend source text (no browser, no build). The analyzer takes a {path: source} map so it can be mutation-tested.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')

const SRC = path.resolve(__dirname, '../../../frontend/src')
function readTree(dir = SRC, base = SRC, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) readTree(full, base, out)
    else if (/\.(jsx?|mjs)$/.test(name)) out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8')
  }
  return out
}

// Pages that legitimately never call a data API directly (static, or they go through AuthContext).
const NO_API_PAGES = new Set(['pages/Landing.jsx', 'pages/Login.jsx', 'pages/Register.jsx'])
// Pages that MUST call these specific API functions (the contract each page exists to fulfil).
const REQUIRED = {
  'pages/Profile.jsx': ['profileApi.getProfile', 'profileApi.updateProfile'],
  'pages/InterviewHistory.jsx': ['interviewApi.getInterviews'],
  'pages/Dashboard.jsx': ['dashboardApi.getPreparation'],
  'pages/ProgressDashboard.jsx': ['dashboardApi.getPerformance'],
  'pages/MyResumes.jsx': ['resumeApi.list', 'resumeApi.upload'],
  'pages/MyApplications.jsx': ['applicationApi.list'],
  'pages/JobBoard.jsx': ['jobApi.list'],
  'pages/HirerJobs.jsx': ['hirerJobApi.list'],
  'pages/HirerDashboard.jsx': ['hirerApplicationApi.dashboard'],
}
// api.js functions that are intentionally not called by any page yet (documented, not forgotten).
// (submitCode is a documented placeholder, submissions go through createSubmission; the two submission-history reads have no page yet.)
const UNUSED_API_ALLOWLIST = new Set(['codingApi.submitCode', 'codingApi.getSubmission', 'codingApi.getMySubmissions',
  // called through the api object injected into utils/faceMonitorController.js (covered by faceMonitor.test.js)
  'faceMonitorApi.submitFrame', 'faceMonitorApi.reportCameraStatus'])
const STALE_MARKERS = [/Not connected to a backend/i, /Saved locally/i, /Phase\s*\d+(\/\d+)?\s*TODO/i, /\bmock(Data|Interview|Coding|Dashboard)/]

function definedApiFunctions(apiSrc) {
  const fns = []
  for (const m of apiSrc.matchAll(/export const (\w+Api) = \{([\s\S]*?)\n\}/g)) {
    for (const k of m[2].matchAll(/^  (\w+):\s*(.*)$/gm)) if (!/^notImplemented\(/.test(k[2])) fns.push(`${m[1]}.${k[1]}`)
  }
  return fns
}

function analyze(files) {
  const problems = []
  const api = files['services/api.js']
  const defined = definedApiFunctions(api)
  const consumers = Object.entries(files).filter(([p]) => p !== 'services/api.js' && p !== 'utils/mockData.js')
  const usedText = consumers.map(([, s]) => s).join('\n')
  for (const fn of defined) {
    const [apiName] = fn.split('.')
    const dynamicallyUsed = usedText.includes(`${apiName}[`) // e.g. adminApi[action](id)
    if (!UNUSED_API_ALLOWLIST.has(fn) && !dynamicallyUsed && !new RegExp(`\\b${fn.replace('.', '\\.')}\\b`).test(usedText)) problems.push(`api.js defines ${fn} but no page or component calls it`)
  }
  for (const [p, s] of consumers) {
    if (/from\s+['"][^'"]*mockData(\.js)?['"]/.test(s)) problems.push(`${p} imports mockData`)
    for (const re of STALE_MARKERS) if (re.test(s)) problems.push(`${p} contains a placeholder marker (${re})`)
  }
  for (const [p, fns] of Object.entries(REQUIRED)) {
    if (!files[p]) { problems.push(`${p} is missing`); continue }
    for (const fn of fns) if (!new RegExp(`\\b${fn.replace('.', '\\.')}\\b`).test(files[p])) problems.push(`${p} does not call ${fn}`)
  }
  for (const [p, s] of Object.entries(files)) {
    if (!p.startsWith('pages/') || NO_API_PAGES.has(p)) continue
    if (!/services\/api\.js|hooks\/|context\//.test(s)) problems.push(`${p} neither imports services/api.js nor a data hook`)
  }
  return { problems, defined }
}

const files = readTree()

test('the frontend source tree is wired to the backend: no unused API functions, no mock imports, no placeholder text', () => {
  const { problems, defined } = analyze(files)
  assert.ok(defined.length > 40, `parsed ${defined.length} API functions`)
  assert.deepEqual(problems, [])
})

test('mutation: a page that stops calling the backend is detected (the original Profile defect)', () => {
  const broken = { ...files, 'pages/Profile.jsx': files['pages/Profile.jsx'].replace(/profileApi\.updateProfile/g, 'noop') }
  assert.ok(analyze(broken).problems.some((p) => p.includes('Profile.jsx does not call profileApi.updateProfile')))
  assert.ok(analyze(broken).problems.some((p) => p.includes('api.js defines profileApi.updateProfile')))
})

test('mutation: a mock-data import is detected (the original History defect)', () => {
  const broken = { ...files, 'pages/InterviewHistory.jsx': "import { mockInterviewHistory } from '../utils/mockData.js'\n" + files['pages/InterviewHistory.jsx'] }
  assert.ok(analyze(broken).problems.some((p) => p.includes('InterviewHistory.jsx imports mockData')))
})

test('mutation: leaving a "not connected" placeholder is detected', () => {
  const broken = { ...files, 'pages/Profile.jsx': files['pages/Profile.jsx'] + '\n// <p>Not connected to a backend yet</p>' }
  assert.ok(analyze(broken).problems.some((p) => p.includes('placeholder marker')))
})

test('History page only reads columns that GET /api/interviews actually returns (interview_sessions)', () => {
  const schema = fs.readFileSync(path.resolve(__dirname, '../../../database/schema.sql'), 'utf8')
  const table = schema.match(/CREATE TABLE interview_sessions \(([\s\S]*?)\n\);/)[1]
  const cols = new Set([...table.matchAll(/^\s+(\w+)\s+[A-Z]/gm)].map((m) => m[1]))
  const read = [...files['pages/InterviewHistory.jsx'].matchAll(/\bs\.(\w+)/g)].map((m) => m[1])
  assert.ok(read.length >= 6)
  for (const c of read) assert.ok(cols.has(c), `InterviewHistory reads s.${c}, which is not an interview_sessions column`)
})

test('Profile page sends exactly the fields the backend validator accepts', () => {
  const validators = fs.readFileSync(path.resolve(__dirname, '../../middleware/validators.js'), 'utf8')
  const rules = validators.match(/const profileUpdateRules = \[([\s\S]*?)\n\]/)[1]
  const accepted = new Set([...rules.matchAll(/body\('(\w+)/g)].map((m) => m[1]))
  const call = files['pages/Profile.jsx'].match(/updateProfile\(\{([\s\S]*?)\}\)/)[1]
  const sent = [...call.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(sent.sort(), ['experienceLevel', 'preferredLanguage', 'skillNames', 'targetRole'])
  for (const f of sent) assert.ok(accepted.has(f), `${f} is not accepted by profileUpdateRules`)
})
