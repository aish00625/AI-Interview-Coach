import test from 'node:test'
import assert from 'node:assert/strict'
import { remainingMs, formatRemaining, answeredCounts, emptyDefinition, toPayload, formIssues, definitionFromDetail, totalMarks, EVENT_CATEGORY_LABELS } from './assessmentView.js'

test('the countdown is anchored to the server clock, not the browser clock', () => {
  const deadline = '2026-11-01T10:30:00.000Z'
  const serverNow = '2026-11-01T10:00:00.000Z'
  // the browser clock is 2 hours wrong: only the elapsed time since the fetch matters
  const fetchedAt = Date.parse('2026-11-01T12:00:00Z')
  assert.equal(remainingMs(deadline, serverNow, fetchedAt, fetchedAt), 30 * 60000)
  assert.equal(remainingMs(deadline, serverNow, fetchedAt, fetchedAt + 60000), 29 * 60000)
  assert.equal(remainingMs(deadline, serverNow, fetchedAt, fetchedAt + 3600000), 0, 'never negative')
  assert.equal(formatRemaining(29 * 60000 + 5000), '29:05')
  assert.equal(formatRemaining(3725000), '1:02:05')
  assert.equal(formatRemaining(-5), '00:00')
})

test('answered / unanswered counts per section', () => {
  const sections = [{ id: 1, kind: 'aptitude', itemCount: 3, items: [{ id: 11 }, { id: 12 }, { id: 13 }] }, { id: 2, kind: 'coding', itemCount: 1, items: [{ id: 21 }] }, { id: 3, kind: 'technical', itemCount: 4, items: [] }]
  const c = answeredCounts(sections, [{ itemId: 11, selectedKeys: ['A'] }, { itemId: 12, selectedKeys: [] }], [{ itemId: 21 }])
  assert.deepEqual(c[1], { answered: 1, total: 3, unanswered: 2 })
  assert.deepEqual(c[2], { answered: 1, total: 1, unanswered: 0 })
  assert.deepEqual(c[3], { answered: 0, total: 4, unanswered: 4 }, 'a section not entered yet still shows its question count')
})

test('builder payload: disabled sections omitted, coding has no negative marking or randomisation, empty fields become null', () => {
  const f = emptyDefinition()
  f.jobId = '7'; f.title = ' Screen '; f.passPercent = ''
  f.sections[0].items = [{ mcqQuestionId: 3, marks: 2 }]
  f.sections[1].enabled = false
  f.sections[2].items = [{ codingProblemId: 9, marks: 10 }]; f.sections[2].negativeMarking = 0.5; f.sections[2].randomize = true
  const p = toPayload(f)
  assert.equal(p.title, 'Screen'); assert.equal(p.passPercent, null); assert.equal(p.jobId, 7)
  assert.deepEqual(p.sections.map((s) => s.kind), ['aptitude', 'coding'])
  assert.equal(p.sections[1].negativeMarking, 0); assert.equal(p.sections[1].randomize, false)
  assert.deepEqual(p.sections[1].items, [{ codingProblemId: 9, marks: 10 }])
  assert.equal(totalMarks(f), 12)
})

test('local form hints catch obvious problems before saving', () => {
  const f = emptyDefinition()
  assert.ok(formIssues(f).some((i) => /job/.test(i)))
  f.jobId = '1'; f.title = 'Screen'; f.durationMinutes = 20; f.sections[0].durationMinutes = 15; f.sections[2].durationMinutes = 15
  assert.ok(formIssues(f).some((i) => /add up/.test(i)))
  f.durationMinutes = 60
  assert.deepEqual(formIssues(f), [])
})

test('editing round trip keeps the section order and switched-off sections', () => {
  const detail = {
    assessment: { jobId: 4, title: 'T', description: null, instructions: 'i', durationMinutes: 30, maxAttempts: 2, passPercent: null, availableFrom: null, availableUntil: null, monitoringEnabled: false },
    sections: [{ kind: 'coding', durationMinutes: null, allowBack: false, randomize: false, negativeMarking: 0, items: [{ codingProblemId: 5, mcqQuestionId: null, marks: 10, summary: 'P' }] }],
  }
  const f = definitionFromDetail(detail)
  assert.deepEqual(f.sections.map((s) => [s.kind, s.enabled]), [['coding', true], ['aptitude', false], ['technical', false]])
  assert.equal(toPayload(f).sections.length, 1)
})

test('monitoring categories are worded as observations, never accusations', () => {
  for (const label of Object.values(EVENT_CATEGORY_LABELS)) assert.doesNotMatch(label, /cheat|suspicious|violation|misconduct|fraud/i)
})

test('monitoring status never claims "active" unless the camera is live AND frames reach the server', async () => {
  const { monitoringStatus } = await import('./assessmentView.js')
  const base = { phase: 'idle', camera: { state: 'off', status: null, message: '' }, framesSent: 0, lastError: '', serviceTrouble: false }
  assert.equal(monitoringStatus(base, '').label, 'Camera off')
  assert.equal(monitoringStatus(base, 'Server error.').label, 'Monitoring unavailable')
  assert.equal(monitoringStatus(base, 'Server error.').canRetry, true)
  assert.equal(monitoringStatus({ ...base, phase: 'starting', camera: { state: 'starting' } }, '').active, false)
  const denied = monitoringStatus({ ...base, phase: 'stopped', camera: { state: 'error', status: 'permission_denied', message: 'Camera permission was denied.' } }, '')
  assert.equal(denied.label, 'Camera problem'); assert.equal(denied.canRestart, true); assert.match(denied.detail, /not against you/)
  const live = { ...base, phase: 'running', camera: { state: 'live' } }
  assert.equal(monitoringStatus(live, '').active, false, 'live camera but no frame analysed yet')
  assert.equal(monitoringStatus({ ...live, serviceTrouble: true, framesSent: 4 }, '').active, false)
  assert.equal(monitoringStatus({ ...live, lastError: 'Could not capture', framesSent: 4 }, '').active, false)
  const ok = monitoringStatus({ ...live, framesSent: 3 }, '')
  assert.equal(ok.active, true); assert.equal(ok.label, 'Monitoring active'); assert.match(ok.detail, /3 frame/)
  assert.equal(monitoringStatus({ ...base, phase: 'stopped', ended: true }, '').label, 'Monitoring ended')
})

test('monitoring analysis uses only stored counters and events; unavailable features are unavailable, not zero', async () => {
  const { monitoringAnalysis } = await import('./assessmentView.js')
  const empty = monitoringAnalysis({ sessions: [], events: [] })
  assert.equal(empty.hasData, false); assert.equal(empty.head.available, false); assert.equal(empty.frames.analysed, 0)

  const session = {
    features: { faceDetection: { state: 'available' }, headPose: { state: 'available' }, gaze: { state: 'unavailable', reason: 'needs_landmark_model' }, identity: { state: 'not_configured' } },
    identity: { requested: false, status: 'not_requested' },
    measurements: { framesTotal: 40, framesUnusable: 4, framesFacePresent: 33, framesNoFace: 3, multiFaceMs: 6000, maxFaces: 2, headEvaluatedMs: 60000, headDeviationMs: 9000, headPoseFrames: 30, gazeEvaluatedMs: 0, gapCount: 1, gapMs: 12000, monitoredMs: 80000 },
  }
  const events = [
    { id: 1, type: 'multiple_faces', category: 'observation', status: 'resolved', durationMs: 6000 },
    { id: 2, type: 'poor_image_quality', category: 'technical_issue', status: 'resolved', durationMs: 7000, evidence: { thresholdMs: 6000, issues: ['too_dark', 'blurry'] } },
    { id: 3, type: 'monitoring_gap', category: 'technical_issue', status: 'resolved', durationMs: 12000 },
    { id: 4, type: 'head_pose_deviation', category: 'observation', status: 'resolved', durationMs: 9000 },
  ]
  const r = monitoringAnalysis({ sessions: [session], events })
  assert.deepEqual(r.frames, { analysed: 40, usable: 36, unusable: 4, facePresent: 33, noFace: 3 })
  assert.deepEqual(r.multipleFaces, { events: 1, totalMs: 6000, maxFaces: 2 })
  assert.equal(r.technicalIssues, 2)
  assert.deepEqual(r.head, { available: true, measuredMs: 60000, deviationMs: 9000, sharePct: 15, frames: 30, events: 1 })
  assert.equal(r.gaze.available, false); assert.match(r.gaze.reason, /not available/)
  assert.deepEqual(r.quality.issueCounts, { too_dark: 1, blurry: 1 }); assert.equal(r.quality.events[0].durationMs, 7000)
  assert.equal(r.identity.state, 'not_configured')
  assert.equal(JSON.stringify(r).match(/score|attention|cheat|suspicious/i), null, 'no invented scores or accusations')
  const noValid = monitoringAnalysis({ sessions: [{ ...session, measurements: { ...session.measurements, headEvaluatedMs: 0 } }], events: [] })
  assert.equal(noValid.head.available, false); assert.match(noValid.head.reason, /No frame gave a reliable measurement/)
})
