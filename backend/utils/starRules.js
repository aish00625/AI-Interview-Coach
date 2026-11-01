/**
 * Rule-based STAR check - the fallback when the local AI model is not available (and a cross-check for it).
 *
 * It looks for wording cues for Situation, Task, Action and Result in the candidate's own sentences. It is a keyword
 * heuristic: it can miss good answers phrased differently and can accept weak answers that use the right words, so the
 * output is labelled "rule_based" and advisory. Evidence is always a verbatim sentence of the answer.
 */
const CUES = {
  situation: /\b(when|while|during|at (my|the|our)|in (my|our|the)|last (year|semester|month|summer)|once|our (team|project|class|group)|my (team|project|class|group)|internship|college|university|company|deadline|we (were|had|faced))\b/i,
  task: /\b(i was (responsible|asked|tasked|assigned|supposed|expected)|my (role|job|task|goal|responsibility|part)|needed to|had to|the goal was|objective|responsible for|in charge of|assigned to)\b/i,
  action: /\bI (?:(?!was\b|am\b|had\b|have\b|would\b|will\b|can\b|could\b|think\b|feel\b|need\b|want\b)[a-z]{3,}ed|wrote|built|led|took|made|ran|set up|chose|found|gave|held|kept|sent|spoke|taught|did)\b/i,
  result: /(\d+\s?%|\b(result(ed|s)?|as a result|outcome|achieved|improved|reduced|increased|saved|delivered|shipped|completed|succeeded|resolved|ended up|in the end|we (won|finished|launched|released)|got (a|an|the)|received|positive feedback)\b)/i,
}
const MEASURABLE = /(\d+\s?%|\b\d+(\.\d+)?\s?(x|times|days?|hours?|weeks?|months?|users?|bugs?|points?|marks?|seconds?|minutes?|percent)\b|\$\s?\d+)/i
const SUGGESTIONS = {
  situation: { missing: 'Open with one sentence of context: where this happened, when, and what was going on.', weak: 'Make the context more specific - name the project, the team size or the deadline.' },
  task: { missing: 'State your own responsibility: what exactly were YOU asked or expected to do?', weak: 'Say more clearly what your personal goal or responsibility was, separate from the team.' },
  action: { missing: 'Describe the steps you took yourself, using "I" (what you decided, built or changed).', weak: 'Add detail on how you did it: the specific steps, tools or decisions that were yours.' },
  result: { missing: 'End with the outcome - what changed because of what you did, and what you learned.', weak: 'Make the result concrete, ideally with a number (time saved, errors reduced, marks or users).' },
}

function sentences(text) {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map((s) => s.trim()).filter(Boolean)
}

function ruleBasedStar(answer) {
  const sents = sentences(answer)
  const elements = {}
  for (const key of Object.keys(CUES)) {
    const hits = sents.filter((s) => CUES[key].test(s))
    // best evidence: the longest matching sentence (more informative than a fragment)
    const best = hits.slice().sort((a, b) => b.length - a.length)[0] || null
    let status = 'missing'
    if (best) {
      const words = best.split(/\s+/).length
      status = words >= 6 ? 'present' : 'weak'
      if (key === 'result' && !MEASURABLE.test(best)) status = 'weak'
    }
    elements[key] = { status, evidence: best ? best.slice(0, 220) : null, suggestion: status === 'present' ? 'Good - keep this level of detail.' : SUGGESTIONS[key][status] }
  }
  const missing = Object.keys(elements).filter((k) => elements[k].status === 'missing')
  const weak = Object.keys(elements).filter((k) => elements[k].status === 'weak')
  const overall = missing.length === 0 && weak.length === 0
    ? 'All four STAR parts are visible in your answer. Check that the result is as concrete as the action.'
    : `Missing: ${missing.join(', ') || 'none'}. Needs more detail: ${weak.join(', ') || 'none'}. Wording cues only, so a good answer phrased differently may be marked down.`
  return { elements, overall, missing, weak, evidenceDropped: 0 }
}

module.exports = { ruleBasedStar, sentences }
