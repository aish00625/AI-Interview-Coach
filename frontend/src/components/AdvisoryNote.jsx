/**
 * Shown wherever an automated score is displayed. The evaluator is a deterministic keyword/similarity
 * checker, not a judge: it can miss correct answers phrased differently. Hiring decisions stay with people.
 */
const TEXT = {
  hirer: 'Automated scores are advisory. They come from a keyword and text-similarity evaluator, can miss good answers worded differently, and must not decide an outcome on their own. Read the actual answers and code.',
  candidate: 'These scores are automated estimates from a keyword and text-similarity evaluator. Treat them as practice feedback, not a verdict on your ability.',
}

export default function AdvisoryNote({ audience = 'hirer', style }) {
  return (
    <p
      role="note"
      style={{ margin: '8px 0 12px', padding: '8px 12px', border: '1px solid var(--border-400)', borderRadius: 6, color: 'var(--text-500)', fontSize: 13, ...style }}
    >
      <strong>Advisory only. </strong>{TEXT[audience] || TEXT.hirer}
    </p>
  )
}
