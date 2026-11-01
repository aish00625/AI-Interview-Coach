/** Structured recruiter scorecards (Phase J). Criteria are per job (jsonb) or these defaults. Ratings are 1-5. */
const DEFAULT_CRITERIA = [
  { key: 'technical_skills', label: 'Technical skills' },
  { key: 'problem_solving', label: 'Problem solving' },
  { key: 'communication', label: 'Communication' },
  { key: 'role_fit', label: 'Fit for the role' },
]
const RECOMMENDATIONS = ['strong_yes', 'yes', 'no', 'strong_no']
const MAX_CRITERIA = 8

function httpError(statusCode, message) { const e = new Error(message); e.statusCode = statusCode; return e }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

/** Validates the hirer-supplied criteria list for a job; returns [{key,label}] or null (= use defaults). */
function normalizeCriteria(input) {
  if (input === null || input === undefined) return null
  if (!Array.isArray(input)) throw httpError(400, 'scorecardCriteria must be a list of criterion names.')
  if (input.length === 0) return null
  if (input.length > MAX_CRITERIA) throw httpError(400, `Use at most ${MAX_CRITERIA} scorecard criteria.`)
  const seen = new Set(); const out = []
  for (const item of input) {
    const label = String(typeof item === 'string' ? item : item && item.label || '').trim()
    if (!label) throw httpError(400, 'Each scorecard criterion needs a name.')
    if (label.length > 80) throw httpError(400, 'A scorecard criterion name must be 80 characters or fewer.')
    const key = slug(label)
    if (!key) throw httpError(400, `"${label}" is not a usable criterion name.`)
    if (seen.has(key)) throw httpError(400, `Duplicate scorecard criterion: ${label}.`)
    seen.add(key); out.push({ key, label })
  }
  return out
}

const criteriaFor = (jobRow) => (Array.isArray(jobRow.scorecard_criteria) && jobRow.scorecard_criteria.length ? jobRow.scorecard_criteria : DEFAULT_CRITERIA)

/** Validates a submitted scorecard against the job's criteria. Every criterion must be rated. */
function validateScorecard({ criteria, ratings, recommendation, summary }) {
  if (!RECOMMENDATIONS.includes(recommendation)) throw httpError(400, 'Choose a recommendation: strong yes, yes, no or strong no.')
  if (!Array.isArray(ratings)) throw httpError(400, 'ratings must be a list.')
  const byKey = new Map()
  for (const r of ratings) {
    if (!r || typeof r.key !== 'string') throw httpError(400, 'Each rating needs a criterion key.')
    if (byKey.has(r.key)) throw httpError(400, `Criterion ${r.key} was rated twice.`)
    const n = Number(r.rating)
    if (!Number.isInteger(n) || n < 1 || n > 5) throw httpError(400, 'Ratings must be whole numbers from 1 to 5.')
    const comment = r.comment == null ? null : String(r.comment).trim() || null
    if (comment && comment.length > 1000) throw httpError(400, 'A rating comment must be 1000 characters or fewer.')
    byKey.set(r.key, { rating: n, comment })
  }
  const known = new Set(criteria.map((c) => c.key))
  for (const k of byKey.keys()) if (!known.has(k)) throw httpError(400, `Unknown scorecard criterion: ${k}.`)
  const missing = criteria.filter((c) => !byKey.has(c.key))
  if (missing.length) throw httpError(400, `Rate every criterion. Missing: ${missing.map((c) => c.label).join(', ')}.`)
  const text = summary == null ? null : String(summary).trim() || null
  if (text && text.length > 2000) throw httpError(400, 'The summary must be 2000 characters or fewer.')
  return {
    recommendation, summary: text,
    ratings: criteria.map((c) => ({ key: c.key, label: c.label, rating: byKey.get(c.key).rating, comment: byKey.get(c.key).comment })),
  }
}

module.exports = { DEFAULT_CRITERIA, RECOMMENDATIONS, MAX_CRITERIA, normalizeCriteria, criteriaFor, validateScorecard }
