/**
 * Session-level results for the redesigned results page and the printable report. Pure functions over the questions the backend
 * returned (each: { id, question_text, topic_name, answered, answer }). Nothing here invents a measurement:
 *  - skipped and not-evaluable answers are left out of every average (they are listed separately), matching the dashboard policy;
 *  - a value with no data stays null, never 0;
 *  - suggestions are fixed rules over those numbers, not AI output, and are labelled as such by the UI.
 */
import { qualityView, answerScores, overallScore, SCORE_KEYS } from './resultsView.js'

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

const DIMENSION_TIPS = {
  technical_score: 'Technical accuracy: re-read the model answer for questions where key concepts were missed, then answer them again in your own words.',
  relevance_score: 'Relevance: start each answer by restating the question\'s main point, then add detail that directly supports it.',
  clarity_score: 'Clarity: use short sentences with one idea each, joined by words such as "because" and "so", instead of lists of terms.',
  completeness_score: 'Completeness: cover the main points the question expects, then finish with an example or a trade-off.',
}
const NEXT_DIFFICULTY = { easy: 'medium', medium: 'hard', hard: 'hard' }

export function summariseResults(questions, session = {}) {
  const list = (Array.isArray(questions) ? questions : []).filter((q) => q && q.answer)
  const rows = list.map((q, i) => {
    const quality = qualityView(q.answer)
    const evaluable = quality ? quality.evaluable : true // answers saved before the status existed count as evaluated
    const meta = q.answer.evaluation_meta || {}
    return {
      index: i + 1, id: q.id, topic: q.topic_name || null, text: q.question_text || '',
      status: quality ? quality.status : null, label: quality ? quality.label : 'Evaluated',
      evaluable, skipped: quality ? quality.skipped : false,
      average: evaluable ? overallScore(q.answer) : null,
      confidence: evaluable && ['high', 'medium', 'low'].includes(meta.confidence) ? meta.confidence : null,
      attempts: Number(meta.attemptCount) > 1 ? Number(meta.attemptCount) : 1,
      answer: q.answer,
    }
  })
  const evaluated = rows.filter((r) => r.evaluable)
  const skipped = rows.filter((r) => r.skipped).length
  const notEvaluable = rows.filter((r) => r.status === 'not_evaluable').length

  const dimensions = SCORE_KEYS.map(([key, label]) => {
    const vals = evaluated.map((r) => answerScores(r.answer).find((s) => s.key === key).value).filter((v) => v !== null)
    return { key, label, average: vals.length ? round(mean(vals)) : null, n: vals.length }
  })
  const measured = dimensions.filter((d) => d.average !== null).sort((a, b) => b.average - a.average)
  const strongest = measured.length >= 2 && measured[0].average !== measured[measured.length - 1].average ? measured[0] : null
  const weakest = strongest ? measured[measured.length - 1] : null

  const conf = { high: 0, medium: 0, low: 0 }
  evaluated.forEach((r) => { if (r.confidence) conf[r.confidence] += 1 })
  const confTotal = conf.high + conf.medium + conf.low
  const confidence = !confTotal ? null : (conf.low / confTotal > 0.5 ? 'low' : conf.high / confTotal > 0.5 ? 'high' : 'medium')

  const avgOfAnswers = evaluated.map((r) => r.average).filter((v) => v !== null)
  const overallAverage = avgOfAnswers.length ? round(mean(avgOfAnswers)) : null

  // Topics: average only over evaluated answers; a topic that has answers but none evaluable is "insufficient data", not weak.
  const byTopic = new Map()
  rows.forEach((r) => {
    if (!r.topic) return
    const t = byTopic.get(r.topic) || { topic: r.topic, scores: [], unscored: 0 }
    if (r.evaluable && r.average !== null) t.scores.push(r.average); else t.unscored += 1
    byTopic.set(r.topic, t)
  })
  const topics = [...byTopic.values()].map((t) => ({ topic: t.topic, average: t.scores.length ? round(mean(t.scores)) : null, answers: t.scores.length, unscored: t.unscored }))
  const weakTopics = topics.filter((t) => t.average !== null && t.average < 60).sort((a, b) => a.average - b.average).slice(0, 4)
  const insufficientTopics = topics.filter((t) => t.average === null)

  const lowestQuestions = evaluated.filter((r) => r.average !== null).sort((a, b) => a.average - b.average).slice(0, 3)

  const nextSteps = []
  if (weakest) nextSteps.push(DIMENSION_TIPS[weakest.key])
  if (skipped) nextSteps.push(`Go back to the ${skipped} skipped question${skipped === 1 ? '' : 's'} in a new practice session; skipped questions count as 0 in the final score.`)
  if (notEvaluable) nextSteps.push(`${notEvaluable} answer${notEvaluable === 1 ? ' was' : 's were'} not evaluable. Write complete sentences in your own words so the answer can be scored.`)
  const lowConf = evaluated.filter((r) => r.confidence === 'low').length
  if (lowConf) nextSteps.push(`${lowConf} score${lowConf === 1 ? ' has' : 's have'} low evaluation confidence. Compare ${lowConf === 1 ? 'that answer' : 'those answers'} with the model answer yourself.`)

  const nextDifficulty = NEXT_DIFFICULTY[session.difficulty] || null
  let suggestedNext
  if (overallAverage === null) suggestedNext = 'No answers could be scored in this session. Try again with complete sentences to get an evaluation.'
  else if (overallAverage >= 75) suggestedNext = nextDifficulty && nextDifficulty !== session.difficulty
    ? `Your answers scored well. Try the same interview type at ${nextDifficulty} difficulty.` : 'Your answers scored well. Try another interview type or a coding problem.'
  else if (overallAverage >= 50) suggestedNext = `Repeat this interview type at the same difficulty${weakest ? `, concentrating on ${weakest.label.toLowerCase()}` : ''}.`
  else suggestedNext = 'Review the model answers for the weakest questions, then repeat this interview type at the same or an easier difficulty.'

  return {
    counts: { total: rows.length, evaluated: evaluated.length, skipped, notEvaluable },
    overallAverage, dimensions, strongest, weakest,
    confidence, confidenceCounts: conf,
    rows, weakTopics, insufficientTopics, lowestQuestions, nextSteps, suggestedNext,
  }
}

/** Speech measurements that actually exist, averaged over the answers that have them. Returns null when none were measured. */
export function speechSummary(questions) {
  const metrics = (Array.isArray(questions) ? questions : []).map((q) => q && q.answer && q.answer.speech_metrics).filter(Boolean)
  if (!metrics.length) return null
  const avg = (key, d = 0) => { const v = metrics.map((m) => m[key]).filter(isNum).map(Number); return v.length ? round(mean(v), d) : null }
  const total = (key) => { const v = metrics.map((m) => m[key]).filter(isNum).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) : null }
  const lowConfidence = metrics.filter((m) => m.transcriptConfidence && m.transcriptConfidence.level === 'low').length
  return {
    answers: metrics.length,
    speakingRateWpm: avg('speakingRateWpm'), fillerWords: total('fillerWordCount'), pauses: total('pauseCount'),
    longestPauseSeconds: (() => { const v = metrics.map((m) => m.longestPauseSeconds).filter(isNum).map(Number); return v.length ? round(Math.max(...v), 1) : null })(),
    timeToFirstWordSeconds: avg('timeToFirstWordSeconds', 1),
    lowConfidenceTranscripts: lowConfidence,
  }
}

/** Typing measurements that exist for text answers. Counts and timings only. Null when none were recorded. */
export function typingSummary(questions) {
  const metrics = (Array.isArray(questions) ? questions : []).map((q) => q && q.answer && q.answer.typing_metrics).filter(Boolean)
  if (!metrics.length) return null
  const avg = (key, d = 0) => { const v = metrics.map((m) => m[key]).filter(isNum).map(Number); return v.length ? round(mean(v), d) : null }
  return { answers: metrics.length, typingSpeedWpm: avg('typingSpeedWpm'), correctionRatio: avg('correctionRatio', 2), longPauses: (() => { const v = metrics.map((m) => m.longPauseCount).filter(isNum).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) : null })() }
}

/** Camera measurements across answers (averages of the ratios that exist). Measurements only, never emotion, attention or ability. */
export function cameraSummary(questions) {
  const cvs = (Array.isArray(questions) ? questions : []).map((q) => q && q.answer && q.answer.cv_metrics).filter(Boolean)
  if (!cvs.length) return null
  const avg = (get) => { const v = cvs.map(get).filter(isNum).map(Number); return v.length ? { value: round(mean(v), 2), n: v.length } : null }
  return {
    answers: cvs.length,
    modelUnavailable: cvs.filter((c) => c.analysisStatus === 'model_unavailable').length,
    facePresence: avg((c) => c.facePresenceRatio),
    facingCamera: avg((c) => c.facingCameraRatio),
    eyeContact: avg((c) => (isNum(c.eyeContactRatio) ? c.eyeContactRatio : (isNum(c.lookingAwayRatio) ? 1 - Number(c.lookingAwayRatio) : null))),
  }
}
