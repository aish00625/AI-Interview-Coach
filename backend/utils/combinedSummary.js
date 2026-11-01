/**
 * One plain-language practice summary that puts CONTENT (the interview score) and DELIVERY (speech, typing, camera
 * measurements) side by side. It is rule-based and uses only numbers that were actually measured. It never changes a
 * score, never mentions emotion, confidence or personality, and is practice advice - not an assessment of the person.
 */
const TIPS = {
  pace: 'Aim for a steady pace of roughly 110-170 words per minute.',
  fluency: 'Pause briefly instead of using filler words; short silences sound more confident than "um".',
  pausing: 'Plan the first sentence of your answer so you avoid long silences.',
  presence: 'Sit centred in the frame with your face lit from the front so the camera can see you throughout.',
  attention: 'Look toward the camera lens while you speak; glance at notes or the screen only briefly.',
  typingPace: 'Draft the answer in a few clear sentences instead of long stops and starts.',
  editing: 'Plan the sentence before typing to reduce rewriting.',
  continuity: 'Keep typing in one flow instead of long pauses; outline first if you need thinking time.',
  originality: null, // describes how the answer was entered; not something to coach
}
const band = (n) => (n >= 70 ? 'strong' : n >= 50 ? 'fair' : 'needs work')

function buildCombinedSummary({ finalScore, delivery }) {
  const hasContent = Number.isFinite(Number(finalScore)) && finalScore !== null
  const hasDelivery = delivery && Number.isFinite(delivery.score)
  if (!hasContent || !hasDelivery) return null
  const content = Math.round(Number(finalScore))
  const d = delivery.score
  const weak = (delivery.components || []).filter((c) => c.score < 60 && TIPS[c.key]).sort((a, b) => a.score - b.score).slice(0, 2)
  const good = (delivery.components || []).filter((c) => c.score >= 80).sort((a, b) => b.score - a.score)[0]

  let lead
  if (content >= 70 && d >= 70) lead = `Your answers were solid on content (${content}/100) and your delivery measured well (${d}/100).`
  else if (content >= 70) lead = `Your answer content was ${band(content)} (${content}/100), while delivery measured ${band(d)} (${d}/100).`
  else if (d >= 70) lead = `Your delivery measured ${band(d)} (${d}/100); the bigger gain now is in answer content (${content}/100).`
  else lead = `Both content (${content}/100) and delivery (${d}/100) have room to grow, so content comes first: cover the key points, then polish how you say them.`

  const focus = weak[0] ? ` Biggest delivery gain: ${weak[0].label.toLowerCase()}.` : ''
  const tips = weak.map((c) => ({ key: c.key, label: c.label, score: c.score, measured: c.weakestDetail, tip: TIPS[c.key] }))
  return {
    advisory: true,
    contentScore: content,
    deliveryScore: d,
    text: lead + (good ? ` Strongest delivery signal: ${good.label.toLowerCase()}.` : '') + focus,
    tips,
    note: 'Practice feedback from simple measurements. See the score breakdown for how each part counted. This does not measure confidence or emotion, and is never shown to employers.',
  }
}

module.exports = { buildCombinedSummary }
