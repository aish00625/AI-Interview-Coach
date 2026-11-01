// Phase W: route guards and privacy boundaries of hirer assessments (static checks; no database).
const test = require('node:test')
const assert = require('node:assert/strict')
const routeInventory = require('../helpers/routeInventory')

const routes = routeInventory.build()
const permOf = (r) => (r.guards.find((g) => g.startsWith('perm:')) || '').slice(5)

test('every hirer assessment and question-bank route: auth, hirer role, approved organization, then a permission', () => {
  const mine = routes.filter((r) => r.fullPath.startsWith('/api/hirer/assessments') || r.fullPath.startsWith('/api/hirer/question-bank'))
  assert.equal(mine.length, 20)
  for (const r of mine) {
    assert.deepEqual(r.guards.slice(0, 3), ['auth', 'role:hirer', 'org'], `${r.method} ${r.fullPath}`)
    const p = permOf(r)
    if (r.fullPath.startsWith('/api/hirer/question-bank')) assert.equal(p, 'manageJobs', `answer keys need manageJobs: ${r.method} ${r.fullPath}`)
    else if (/\/attempts\/:attemptId\/(notes|review-status)$/.test(r.fullPath)) assert.equal(p, 'review', `${r.method} ${r.fullPath}`)
    else assert.equal(p, r.method === 'GET' ? 'view' : 'manageJobs', `${r.method} ${r.fullPath}`)
  }
})

test('candidate assessment routes are candidate-only; code submission is rate limited', () => {
  const mine = routes.filter((r) => r.fullPath.startsWith('/api/assessments'))
  assert.equal(mine.length, 11)
  for (const r of mine) {
    assert.deepEqual(r.guards.filter((g) => g !== 'ratelimit'), ['auth', 'role:candidate'], `${r.method} ${r.fullPath}`)
  }
  assert.ok(mine.find((r) => r.fullPath === '/api/assessments/attempts/:attemptId/coding/:itemId').guards.includes('ratelimit'))
})

test('candidate-facing queries never select answer keys, explanations or hidden tests', () => {
  const attemptModel = require('../../models/assessmentAttemptModel')
  const src = attemptModel.getCandidateItems.toString().replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(src, /correct_keys|explanation|test_cases/)
  const inv = require('fs').readFileSync(require.resolve('../../models/assessmentAttemptModel'), 'utf8').match(/const INVITATION_SELECT = `[\s\S]*?`/)[0]
  assert.doesNotMatch(inv, /correct_keys|explanation|test_cases/)
})

test('candidateSections strips keys even when the row carries them', () => {
  const { candidateSections } = require('../../services/assessmentBuilderService')
  const rows = [
    { id: 1, section_id: 10, kind: 'aptitude', section_position: 1, duration_minutes: null, allow_back: true, negative_marking: 0, marks: 1,
      question_text: 'Q?', question_type: 'single', choices: [{ key: 'A', text: 'x' }, { key: 'B', text: 'y' }], correct_keys: ['A'], explanation: 'TOP-SECRET' },
    { id: 2, section_id: 11, kind: 'coding', section_position: 2, duration_minutes: 30, allow_back: false, negative_marking: 0, marks: 10,
      problem_id: 5, problem_title: 'P', problem_description: 'd', problem_difficulty: 'easy', problem_constraints: 'c', problem_examples: [], test_cases: [{ input: 'HIDDEN' }] },
  ]
  const out = JSON.stringify(candidateSections(rows, { 10: [1], 11: [2] }))
  assert.doesNotMatch(out, /correct|TOP-SECRET|HIDDEN|test_cases/)
  assert.match(out, /"key":"A"/)
})

test('scoring and results never read monitoring data into a score', () => {
  const attempt = require('../../services/assessmentAttemptService')
  assert.doesNotMatch(attempt.scoreAttempt.toString(), /monitor|face|gaze/i)
  const builder = require('fs').readFileSync(require.resolve('../../utils/assessmentRules'), 'utf8')
  for (const fn of ['scoreMcq', 'scoreCoding', 'sectionTotal', 'overall']) {
    const body = builder.match(new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0]
    assert.doesNotMatch(body, /monitor|face|gaze/i, fn)
  }
})

test('every face-monitoring consent version fits face_monitoring_sessions.consent_version (VARCHAR(20))', () => {
  const fm = require('../../services/faceMonitorService')
  const sql = require('fs').readFileSync(require.resolve('../../../database/migrations/017_face_monitoring.sql'), 'utf8')
  const limit = Number(sql.match(/consent_version\s+VARCHAR\((\d+)\)/)[1])
  for (const v of [fm.CONSENT_VERSION, fm.ASSESSMENT_CONSENT_VERSION, fm.assessmentPrivacyNotice().consentVersion, fm.privacyNotice().consentVersion]) {
    assert.ok(typeof v === 'string' && v.length <= limit, `"${v}" is longer than ${limit}`)
  }
  assert.equal(fm.assessmentPrivacyNotice().consentVersion, fm.ASSESSMENT_CONSENT_VERSION, 'the notice shown and the version stored are the same')
})
