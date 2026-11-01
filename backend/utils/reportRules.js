/**
 * Rule-based end-of-interview report (fallback when the local AI model is unavailable). Everything stated comes from the
 * stored scores and criteria of the candidate's own answers - no model, no invented content.
 */
const avg = (xs) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const r0 = (n) => Math.round(n)
const DIMENSIONS = [['technical', 'technical accuracy'], ['relevance', 'relevance to the question'], ['clarity', 'clarity'], ['completeness', 'completeness']]

function ruleBasedReport({ items, finalScore }) {
  if (!items.length) return { summary: 'No answers were recorded in this interview, so there is nothing to report on yet.', strengths: [], improvements: [], nextSteps: ['Start a practice interview and answer at least a few questions.'] }
  const dim = DIMENSIONS.map(([k, label]) => ({ k, label, v: avg(items.map((i) => i[k])) })).filter((d) => d.v != null)
  const sorted = dim.slice().sort((a, b) => b.v - a.v)
  const best = sorted[0]; const worst = sorted[sorted.length - 1]
  const missingCount = new Map()
  for (const it of items) for (const m of it.missing || []) missingCount.set(m, (missingCount.get(m) || 0) + 1)
  const topMissing = [...missingCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m)
  const topics = items.filter((i) => i.topic && typeof i.technical === 'number')
  const byScore = topics.slice().sort((a, b) => b.technical - a.technical)

  const summary = `Your practice score for this interview was ${finalScore == null ? 'not calculated' : `${r0(finalScore)}/100`} across ${items.length} answer${items.length === 1 ? '' : 's'}. `
    + (best && worst && best.k !== worst.k ? `Your strongest area was ${best.label} (${r0(best.v)}) and the weakest was ${worst.label} (${r0(worst.v)}). ` : '')
    + 'These scores come from a keyword-based rubric, so treat them as practice feedback, not a verdict.'
  const strengths = []
  if (best && best.v >= 70) strengths.push(`${best.label[0].toUpperCase()}${best.label.slice(1)} averaged ${r0(best.v)}/100.`)
  if (byScore[0] && byScore[0].technical >= 70) strengths.push(`Strongest answer topic: ${byScore[0].topic} (${r0(byScore[0].technical)}/100 technical).`)
  const improvements = []
  if (worst && worst.v < 70) improvements.push(`${worst.label[0].toUpperCase()}${worst.label.slice(1)} averaged ${r0(worst.v)}/100 - the biggest gap.`)
  if (topMissing.length) improvements.push(`Points your answers often did not cover: ${topMissing.join('; ')}.`)
  const low = byScore[byScore.length - 1]
  if (low && low.technical < 60) improvements.push(`Lowest answer topic: ${low.topic} (${r0(low.technical)}/100 technical).`)
  const nextSteps = []
  if (topMissing.length) nextSteps.push(`Next time, make sure each answer touches: ${topMissing[0]}.`)
  if (low && low.topic) nextSteps.push(`Practise another ${low.topic} question and compare the score.`)
  if (!nextSteps.length) nextSteps.push('Try a harder difficulty or a different interview type.')
  return { summary, strengths, improvements, nextSteps }
}

module.exports = { ruleBasedReport }
