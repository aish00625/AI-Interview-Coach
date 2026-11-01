/**
 * Personalised question selection and adaptive difficulty for PRIVATE PRACTICE sessions only.
 *
 * Everything here is pure and deterministic (no randomness, no AI): the same profile, history and bank always give
 * the same questions, and every choice carries a plain-language reason the candidate can read. It is deliberately
 * never used for job assessments, where every applicant must get the same questions (see interviewService).
 */
const { canonicalSkillName } = require('./skillSynonyms')

const DIFFICULTIES = ['easy', 'medium', 'hard']
const WEAK_TOPIC_THRESHOLD = 65 // average score (0-100) below which a topic counts as weak
const ADAPT_UP_AT = 75
const ADAPT_DOWN_AT = 45
const ADAPT_MIN_SESSIONS = 2
const norm = (s) => canonicalSkillName(s).toLowerCase()

/**
 * Practice difficulty from recent completed PRACTICE sessions of the same interview type (most recent first).
 * Needs at least two sessions; moves at most one level; never leaves easy..hard.
 * @returns {{ difficulty: string, changed: boolean, reason: string }}
 */
function adaptDifficulty({ requested, recentScores = [] }) {
  const scores = recentScores.map(Number).filter((n) => Number.isFinite(n))
  const idx = DIFFICULTIES.indexOf(requested)
  if (idx === -1) return { difficulty: requested, changed: false, reason: 'Difficulty was not adjusted.' }
  if (scores.length < ADAPT_MIN_SESSIONS) {
    return { difficulty: requested, changed: false, reason: `Adaptive difficulty needs at least ${ADAPT_MIN_SESSIONS} completed practice sessions of this type; you have ${scores.length}, so your chosen difficulty was kept.` }
  }
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  if (avg >= ADAPT_UP_AT && idx < DIFFICULTIES.length - 1) {
    return { difficulty: DIFFICULTIES[idx + 1], changed: true, reason: `Your last ${scores.length} practice sessions of this type averaged ${avg}/100, so difficulty was raised from ${requested} to ${DIFFICULTIES[idx + 1]}.` }
  }
  if (avg <= ADAPT_DOWN_AT && idx > 0) {
    return { difficulty: DIFFICULTIES[idx - 1], changed: true, reason: `Your last ${scores.length} practice sessions of this type averaged ${avg}/100, so difficulty was lowered from ${requested} to ${DIFFICULTIES[idx - 1]} to build confidence.` }
  }
  return { difficulty: requested, changed: false, reason: `Your last ${scores.length} practice sessions averaged ${avg}/100, which is within the range where your chosen difficulty (${requested}) fits.` }
}

const ROLE_ALIASES = { 'front-end': 'frontend', 'front end': 'frontend', 'back-end': 'backend', 'back end': 'backend', 'full-stack': 'fullstack', 'full stack': 'fullstack', 'dev ops': 'devops' }
function roleKeywords(targetRole) {
  let text = String(targetRole || '').toLowerCase()
  for (const [alias, canonical] of Object.entries(ROLE_ALIASES)) text = text.split(alias).join(canonical)
  const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean))
  if (words.has('fullstack')) { words.add('frontend'); words.add('backend') }
  return words
}

/**
 * @param {{
 *   pool: Array<{ text: string, type: string, topicName: string|null, difficulty: string, tags?: string[], roles?: string[] }>,
 *   interviewType: string, difficulty: string, count: number,
 *   profile?: { skills?: string[], targetRole?: string },
 *   weakTopics?: Array<{ topicName: string, average: number }>,
 *   recentTexts?: Set<string>|string[],
 * }} input
 * @returns {Array<{ question: object, reasons: string[], score: number }>}
 */
function selectPersonalized({ pool, interviewType, difficulty, count, profile = {}, weakTopics = [], recentTexts = [] }) {
  const skillSet = new Set((profile.skills || []).map(norm))
  const roleSet = roleKeywords(profile.targetRole)
  const weak = new Map(weakTopics.filter((w) => w.average < WEAK_TOPIC_THRESHOLD).map((w) => [w.topicName, w.average]))
  const recent = new Set(recentTexts)
  const diffIdx = (d) => DIFFICULTIES.indexOf(d)

  const scored = pool.map((q, order) => {
    const reasons = []
    let score = ({ 0: 3, 1: 1 }[Math.abs(diffIdx(q.difficulty) - diffIdx(difficulty))] ?? -1)
    const matchedTags = (q.tags || []).filter((t) => skillSet.has(norm(t)))
    if (matchedTags.length) { score += 4 * Math.min(matchedTags.length, 2); reasons.push(`Matches your skill${matchedTags.length > 1 ? 's' : ''}: ${matchedTags.join(', ')}`) }
    if (q.topicName && weak.has(q.topicName)) {
      const avg = Math.round(weak.get(q.topicName))
      score += 4 + Math.max(0, (WEAK_TOPIC_THRESHOLD - avg) / 20)
      reasons.push(`Targets a weaker topic: ${q.topicName} (your practice average there is ${avg}/100)`)
    }
    if ((q.roles || []).some((r) => roleSet.has(r))) { score += 2; reasons.push(`Relevant to your target role${profile.targetRole ? `: ${profile.targetRole}` : ''}`) }
    if (recent.has(q.text)) score -= 6
    return { question: q, reasons, score, order, repeat: recent.has(q.text) }
  })

  const quotas = interviewType === 'mixed' ? { technical: 3, behavioral: 1, hr: 1 } : null
  const chosen = []
  const taken = { technical: 0, behavioral: 0, hr: 0 }
  const available = [...scored]
  while (chosen.length < count && available.length) {
    const eligible = quotas ? available.filter((s) => taken[s.question.type] < quotas[s.question.type]) : available
    const candidates = eligible.length ? eligible : available
    // Diversity: avoid five questions on the same topic/tag by discounting repeats of what is already chosen.
    const adjusted = candidates.map((s) => {
      let adj = s.score
      if (chosen.some((c) => c.question.topicName && c.question.topicName === s.question.topicName)) adj -= 2
      if (chosen.some((c) => (c.question.tags || []).some((t) => (s.question.tags || []).includes(t)))) adj -= 1.5
      return { s, adj }
    })
    adjusted.sort((a, b) => b.adj - a.adj || a.s.order - b.s.order)
    const pick = adjusted[0].s
    chosen.push(pick)
    taken[pick.question.type] = (taken[pick.question.type] || 0) + 1
    available.splice(available.indexOf(pick), 1)
  }
  return chosen.map((c) => ({
    question: c.question,
    score: c.score,
    reasons: c.reasons.length ? c.reasons : [c.repeat ? 'Revisit: asked recently, but nothing newer fits your difficulty' : 'Core question at this difficulty'],
  }))
}

module.exports = { adaptDifficulty, selectPersonalized, roleKeywords, DIFFICULTIES, WEAK_TOPIC_THRESHOLD }
