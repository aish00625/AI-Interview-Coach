import test from 'node:test'
import assert from 'node:assert/strict'
import { summariseResults, speechSummary, typingSummary, cameraSummary } from './resultsSummary.js'

const ans = (scores, meta = {}, extra = {}) => ({ technical_score: scores[0], relevance_score: scores[1], clarity_score: scores[2], completeness_score: scores[3], evaluation_meta: meta, ...extra })
const q = (id, topic, answer) => ({ id, topic_name: topic, question_text: `Q${id}`, answered: Boolean(answer), answer })
const good = (s, conf = 'high') => ans(s, { confidence: conf, answerQuality: { status: 'good', label: 'Good answer' } })
const skipped = () => ans([0, 0, 0, 0], { skipped: true, answerQuality: { status: 'skipped', label: 'Skipped' } })
const notEval = () => ans([0, 0, 0, 0], { confidence: 'low', answerQuality: { status: 'not_evaluable', label: 'Not evaluable' } })

test('skipped and not-evaluable answers are excluded from averages and listed separately', () => {
  const r = summariseResults([q(1, 'OOP', good([80, 70, 90, 60])), q(2, 'OOP', skipped()), q(3, 'DBMS', notEval()), q(4, 'DBMS', good([40, 40, 80, 40]))], { difficulty: 'easy' })
  assert.deepEqual(r.counts, { total: 4, evaluated: 2, skipped: 1, notEvaluable: 1 })
  assert.equal(r.overallAverage, Math.round(((80 + 70 + 90 + 60) / 4 + (40 + 40 + 80 + 40) / 4) / 2))
  assert.equal(r.dimensions.find((d) => d.key === 'technical_score').average, 60)
  assert.equal(r.dimensions.find((d) => d.key === 'clarity_score').average, 85)
  assert.equal(r.strongest.key, 'clarity_score')
  assert.ok(['technical_score', 'completeness_score', 'relevance_score'].includes(r.weakest.key))
  assert.equal(r.rows[1].average, null); assert.equal(r.rows[2].average, null)
})

test('topic with only skipped / not-evaluable answers is insufficient data, never weak', () => {
  const r = summariseResults([q(1, 'Networking', skipped()), q(2, 'Networking', notEval()), q(3, 'OOP', good([30, 30, 30, 30]))])
  assert.deepEqual(r.insufficientTopics.map((t) => t.topic), ['Networking'])
  assert.deepEqual(r.weakTopics.map((t) => t.topic), ['OOP'])
})

test('no evaluated answers: nothing is invented', () => {
  const r = summariseResults([q(1, 'OOP', skipped())])
  assert.equal(r.overallAverage, null); assert.equal(r.strongest, null); assert.equal(r.weakest, null); assert.equal(r.confidence, null)
  assert.ok(r.dimensions.every((d) => d.average === null))
  assert.match(r.suggestedNext, /No answers could be scored/)
  assert.ok(r.nextSteps.some((s) => /skipped question/.test(s)))
  assert.deepEqual(summariseResults([]).counts, { total: 0, evaluated: 0, skipped: 0, notEvaluable: 0 })
})

test('evaluation confidence is reported separately from quality, from the evaluated answers only', () => {
  const r = summariseResults([q(1, 'A', good([80, 80, 80, 80], 'high')), q(2, 'A', good([80, 80, 80, 80], 'low')), q(3, 'A', notEval())])
  assert.deepEqual(r.confidenceCounts, { high: 1, medium: 0, low: 1 })
  assert.equal(r.confidence, 'medium')
  assert.equal(summariseResults([q(1, 'A', good([80, 80, 80, 80], 'low'))]).confidence, 'low')
  assert.match(summariseResults([q(1, 'A', good([80, 80, 80, 80], 'low'))]).nextSteps.join(' '), /low evaluation confidence/)
})

test('suggested next interview follows the average and difficulty', () => {
  assert.match(summariseResults([q(1, 'A', good([90, 90, 90, 90]))], { difficulty: 'easy' }).suggestedNext, /medium difficulty/)
  assert.match(summariseResults([q(1, 'A', good([90, 90, 90, 90]))], { difficulty: 'hard' }).suggestedNext, /another interview type/)
  assert.match(summariseResults([q(1, 'A', good([60, 60, 60, 60]))], { difficulty: 'easy' }).suggestedNext, /same difficulty/)
  assert.match(summariseResults([q(1, 'A', good([20, 20, 20, 20]))], { difficulty: 'easy' }).suggestedNext, /Review the model answers/)
})

test('speech, typing and camera summaries only use measurements that exist', () => {
  assert.equal(speechSummary([q(1, 'A', ans([1, 1, 1, 1]))]), null)
  const qs = [q(1, 'A', ans([1, 1, 1, 1], {}, { speech_metrics: { speakingRateWpm: 120, fillerWordCount: 3, pauseCount: 2, longestPauseSeconds: 2.4 } })),
    q(2, 'A', ans([1, 1, 1, 1], {}, { speech_metrics: { speakingRateWpm: 140, fillerWordCount: 1, transcriptConfidence: { level: 'low' } } }))]
  const s = speechSummary(qs)
  assert.deepEqual([s.answers, s.speakingRateWpm, s.fillerWords, s.pauses, s.longestPauseSeconds, s.lowConfidenceTranscripts], [2, 130, 4, 2, 2.4, 1])
  assert.equal(s.timeToFirstWordSeconds, null) // not measured -> null, not 0
  assert.equal(typingSummary([q(1, 'A', ans([1, 1, 1, 1]))]), null)
  assert.equal(typingSummary([q(1, 'A', ans([1, 1, 1, 1], {}, { typing_metrics: { typingSpeedWpm: 40, longPauseCount: 2 } }))]).typingSpeedWpm, 40)
  assert.equal(cameraSummary([]), null)
  const c = cameraSummary([q(1, 'A', ans([1, 1, 1, 1], {}, { cv_metrics: { facePresenceRatio: 0.9, analysisStatus: 'model_unavailable' } })),
    q(2, 'A', ans([1, 1, 1, 1], {}, { cv_metrics: { facePresenceRatio: 0.7, facingCameraRatio: 0.5, lookingAwayRatio: 0.2 } }))])
  assert.equal(c.facePresence.value, 0.8); assert.equal(c.facingCamera.n, 1); assert.equal(c.eyeContact.value, 0.8); assert.equal(c.modelUnavailable, 1)
})
