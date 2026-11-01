/**
 * Pure rules for hirer-built assessments (migration 018): question validation, the candidate-safe view of a question,
 * server-side scoring, publish validation and timing. No database access, so every rule here is unit tested directly.
 *
 * Boundaries:
 *  - correct answers and explanations never appear in anything built by `candidateQuestion` / `candidateItem`
 *  - scores come only from saved answers and executor results; monitoring data is not an input to any function here
 *  - "meets pass mark" is informational: nothing here (or anywhere) changes an application's status from it
 */
const SECTION_KINDS = ['aptitude', 'technical', 'coding']
const MCQ_KINDS = ['aptitude', 'technical']
const CATEGORIES = {
  aptitude: ['numerical', 'logical', 'verbal', 'general'],
  technical: ['programming', 'dsa', 'dbms', 'os', 'networks', 'java', 'python', 'javascript', 'cpp', 'web', 'other'],
}
const CHOICE_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const MIN_CHOICES = 4
const MAX_CHOICES = 8
const MAX_ITEMS_PER_SECTION = { aptitude: 100, technical: 100, coding: 5 }
const CONSENT_VERSION = 'assessment-2026-11-v1'

const round2 = (n) => Math.round(n * 100) / 100

/** Normalises and validates a question from the hirer. Returns { question, errors }. Choice keys are assigned A, B, C... */
function validateQuestion(input) {
  const errors = []
  const sectionKind = input && input.sectionKind
  if (!MCQ_KINDS.includes(sectionKind)) errors.push('sectionKind must be aptitude or technical.')
  const category = input && input.category
  if (MCQ_KINDS.includes(sectionKind) && !CATEGORIES[sectionKind].includes(category)) errors.push(`category must be one of: ${(CATEGORIES[sectionKind] || []).join(', ')}.`)
  const questionType = input && input.questionType === 'multiple' ? 'multiple' : 'single'
  const text = typeof (input && input.questionText) === 'string' ? input.questionText.trim() : ''
  if (text.length < 5 || text.length > 4000) errors.push('The question must be 5-4000 characters.')
  const rawChoices = Array.isArray(input && input.choices) ? input.choices : []
  const texts = rawChoices.map((c) => (typeof c === 'string' ? c : c && c.text)).map((t) => (typeof t === 'string' ? t.trim() : ''))
  if (texts.length < MIN_CHOICES || texts.length > MAX_CHOICES) errors.push(`Give ${MIN_CHOICES} to ${MAX_CHOICES} choices.`)
  if (texts.some((t) => t.length < 1 || t.length > 1000)) errors.push('Every choice needs 1-1000 characters of text.')
  if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) errors.push('Choices must be different from each other.')
  const choices = texts.slice(0, MAX_CHOICES).map((t, i) => ({ key: CHOICE_KEYS[i], text: t }))
  const keys = new Set(choices.map((c) => c.key))
  const correct = [...new Set((Array.isArray(input && input.correctKeys) ? input.correctKeys : []).map(String))].sort()
  if (!correct.length) errors.push('Mark at least one correct choice.')
  if (correct.some((k) => !keys.has(k))) errors.push('A correct answer refers to a choice that does not exist.')
  if (questionType === 'single' && correct.length !== 1) errors.push('A single-answer question needs exactly one correct choice.')
  if (questionType === 'multiple' && correct.length < 2) errors.push('A multiple-answer question needs at least two correct choices (use single-answer otherwise).')
  const explanation = typeof (input && input.explanation) === 'string' && input.explanation.trim() ? input.explanation.trim() : null
  if (explanation && explanation.length > 4000) errors.push('The explanation is too long (max 4000 characters).')
  const difficulty = ['easy', 'medium', 'hard'].includes(input && input.difficulty) ? input.difficulty : 'medium'
  const marks = input && input.marks != null ? Number(input.marks) : 1
  if (!Number.isFinite(marks) || marks <= 0 || marks > 100) errors.push('Marks must be more than 0 and at most 100.')
  return {
    errors,
    question: { sectionKind, category, questionType, questionText: text, choices, correctKeys: correct, explanation, difficulty, marks: round2(marks) },
  }
}

/** What a candidate (or a hirer previewing as a candidate) may see of a question: never the answer key or explanation. */
function candidateQuestion(q) {
  return {
    questionText: q.question_text ?? q.questionText,
    questionType: q.question_type ?? q.questionType,
    choices: (q.choices || []).map((c) => ({ key: c.key, text: c.text })),
  }
}

/** Canonical form of a selection: unique, known keys only, sorted. Anything else is dropped. */
function normalizeSelection(selected, choices) {
  const keys = new Set((choices || []).map((c) => c.key))
  return [...new Set((Array.isArray(selected) ? selected : []).map(String))].filter((k) => keys.has(k)).sort()
}

/**
 * Scores one MCQ. Single: the one right key. Multiple: exactly the right set (no partial credit).
 * Unanswered scores 0; a wrong answer loses `negativeMarking` x marks (0 when negative marking is off).
 */
function scoreMcq({ selected, correctKeys, marks, negativeMarking = 0 }) {
  const sel = [...new Set(selected || [])].sort()
  if (!sel.length) return { answered: false, isCorrect: null, awarded: 0 }
  const right = [...new Set(correctKeys || [])].sort()
  const isCorrect = sel.length === right.length && sel.every((k, i) => k === right[i])
  return { answered: true, isCorrect, awarded: isCorrect ? round2(Number(marks)) : (round2(-Number(negativeMarking) * Number(marks)) || 0) }
}

/** Coding: marks x (tests passed / total) of the BEST submission for the item. No submission scores 0. */
function scoreCoding({ marks, best }) {
  if (!best || !best.tests_total) return { awarded: 0, fraction: 0 }
  const fraction = Math.max(0, Math.min(1, best.tests_passed / best.tests_total))
  return { awarded: round2(Number(marks) * fraction), fraction }
}

/** Section score never drops below zero because of negative marking. */
function sectionTotal(awards, max) {
  const raw = awards.reduce((s, a) => s + a, 0)
  return { score: round2(Math.max(0, raw)), max: round2(max) }
}

/** Overall result. `meetsPassMark` is null when no pass mark is configured. Monitoring is deliberately not a parameter. */
function overall(sectionScores, passPercent) {
  const score = round2(Object.values(sectionScores).reduce((s, x) => s + x.score, 0))
  const max = round2(Object.values(sectionScores).reduce((s, x) => s + x.max, 0))
  const percent = max > 0 ? round2((score / max) * 100) : 0
  const meetsPassMark = passPercent == null ? null : percent >= Number(passPercent)
  return { score, max, percent, meetsPassMark }
}

/** Returns the reasons an assessment cannot be published yet (empty array = publishable). */
function publishProblems(a, sections, itemsBySection, now = Date.now()) {
  const p = []
  if (!a.title || a.title.trim().length < 3) p.push('Add a title.')
  if (!a.instructions || !a.instructions.trim()) p.push('Add instructions for candidates.')
  if (!(a.duration_minutes >= 5)) p.push('Set a duration of at least 5 minutes.')
  if (a.available_until && new Date(a.available_until).getTime() <= now) p.push('The availability window has already ended.')
  if (!sections.length) p.push('Add at least one section.')
  const positions = sections.map((s) => s.position).sort()
  if (positions.some((n, i) => n !== i + 1)) p.push('Section order must be 1, 2, 3 without gaps.')
  let sectionMinutes = 0
  for (const s of sections) {
    const items = itemsBySection[s.id] || []
    if (!items.length) p.push(`The ${s.kind} section has no questions.`)
    if (items.length > MAX_ITEMS_PER_SECTION[s.kind]) p.push(`The ${s.kind} section has more than ${MAX_ITEMS_PER_SECTION[s.kind]} items.`)
    if (s.duration_minutes) sectionMinutes += s.duration_minutes
    if (s.kind === 'coding' && Number(s.negative_marking) > 0) p.push('Negative marking does not apply to the coding section.')
    if (items.some((i) => (s.kind === 'coding') !== Boolean(i.coding_problem_id))) p.push(`The ${s.kind} section contains an item of the wrong type.`)
    if (items.some((i) => i.archived)) p.push(`The ${s.kind} section uses an archived question.`)
  }
  if (sectionMinutes > (a.duration_minutes || 0)) p.push('Section durations add up to more than the assessment duration.')
  return [...new Set(p)]
}

/** The attempt deadline: start + duration, cut off at the availability end. Decided by the server only. */
function attemptDeadline(startedAtMs, durationMinutes, availableUntil) {
  const byDuration = startedAtMs + durationMinutes * 60000
  const cap = availableUntil ? new Date(availableUntil).getTime() : Infinity
  return Math.min(byDuration, cap)
}

/** A section's own deadline (if it has a duration), never later than the attempt deadline. */
function sectionDeadline(enteredAtMs, durationMinutes, attemptDeadlineMs) {
  if (!durationMinutes || enteredAtMs == null) return attemptDeadlineMs
  return Math.min(enteredAtMs + durationMinutes * 60000, attemptDeadlineMs)
}

/** Deterministic shuffle (mulberry32) so a randomized order is fixed per attempt and reproducible in tests. */
function shuffled(list, seed) {
  let a = seed >>> 0
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** Whether a candidate may open an assessment now. Returns null when allowed, otherwise a short reason code. */
function availability(a, now = Date.now()) {
  if (a.status !== 'published') return a.status === 'closed' ? 'closed' : 'not_published'
  if (a.available_from && new Date(a.available_from).getTime() > now) return 'not_open_yet'
  if (a.available_until && new Date(a.available_until).getTime() <= now) return 'window_ended'
  return null
}

module.exports = {
  SECTION_KINDS, MCQ_KINDS, CATEGORIES, CHOICE_KEYS, MIN_CHOICES, MAX_CHOICES, MAX_ITEMS_PER_SECTION, CONSENT_VERSION,
  validateQuestion, candidateQuestion, normalizeSelection, scoreMcq, scoreCoding, sectionTotal, overall, publishProblems,
  attemptDeadline, sectionDeadline, shuffled, availability, round2,
}
