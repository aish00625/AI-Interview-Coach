/**
 * How a PRACTICE interview's final score was calculated ("ladder" layout): one row per category with score × applied weight,
 * points added and a running total, ending in the final score. Measured vs automated evaluation is shown per row. Unavailable categories say why and are NOT shown as 0.
 * Camera is labelled experimental. Old sessions (no stored breakdown) are shown as scored on content only.
 */
const muted = { color: 'var(--text-500)' }
const KIND = { measured: 'Measured', automated_evaluation: 'Automated evaluation' }
const fmt = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10))

export default function ScoreBreakdown({ breakdown, completed }) {
  if (!completed) return null
  if (!breakdown) {
    return (
      <p className="small" style={{ margin: '0 0 20px', ...muted }}>
        This interview was scored on answer content only (it was completed before behaviour scoring existed).
      </p>
    )
  }
  const cats = breakdown.categories || []
  const redistributed = cats.some((c) => c.status !== 'measured')
  const COLORS = ['var(--indigo-500)', 'var(--accent-teal)', 'var(--accent-amber)', 'var(--violet-500)']
  let running = 0
  const rows = cats.map((c, i) => {
    const measured = c.status === 'measured'
    if (measured) running += Number(c.points) || 0
    return { c, measured, color: COLORS[i % COLORS.length], total: measured ? running : null }
  })
  const num = { width: 56, textAlign: 'right', flexShrink: 0 }
  return (
    <section aria-label="Score breakdown" style={{ margin: '0 0 24px' }}>
      <h3 style={{ margin: '0 0 6px' }}>How your score was built</h3>
      <p className="small" style={{ margin: '0 0 6px', ...muted }}>
        Points = category score × weight used. The points add up to the final score. Columns: points added, running total.
      </p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map(({ c, measured, color, total }) => (
          <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-400, #444)', ...(measured ? null : muted) }}>
            <span aria-hidden="true" style={{ width: 6, height: 30, borderRadius: 3, flexShrink: 0, ...(measured ? { background: color } : { border: '1px dashed var(--text-500)', boxSizing: 'border-box' }) }} />
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <strong>{c.label}</strong>
              {c.experimental && <span className="badge" style={{ marginLeft: 6 }}>Experimental</span>}
              <div className="small" style={muted}>
                {measured
                  ? `${fmt(c.score)} × ${fmt(c.appliedWeight)}% (set to ${fmt(c.configuredWeight)}%) · ${(KIND[c.kind] || c.kind).toLowerCase()}`
                  : `Unavailable: ${c.reason}`}
              </div>
              {measured && c.coverage && c.coverage.answersTotal > 0 && <div className="small" style={muted}>{c.coverage.answersMeasured} of {c.coverage.answersTotal} answers</div>}
              {c.limitation && <div className="small" style={muted}>{c.limitation}</div>}
            </div>
            <strong style={num}>{measured ? `+${fmt(c.points)}` : '—'}</strong>
            <span style={{ ...num, ...muted }}>{measured ? fmt(total) : '—'}</span>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '2px solid var(--border-400, #444)', paddingTop: 10 }}>
        <span className="small" style={muted}>Final score</span>
        <strong style={{ fontSize: '1.5rem' }}>{fmt(breakdown.finalScore)}</strong>
      </div>
      {redistributed && <p className="small" style={{ margin: '8px 0 0', ...muted }}>Signals that could not be measured are not counted as zero; their weight moved to the categories that were measured.</p>}
      {(breakdown.warnings || []).map((w) => <p key={w} className="small" style={{ margin: '4px 0 0', ...muted }}>{w}</p>)}
      <p className="small" style={{ margin: '8px 0 0', ...muted }}>
        Measured values are counts, timings and ratios. Camera signals are noisy and experimental and are not evidence of ability, confidence, honesty, personality or emotion.
        AI-written feedback (follow-ups, coaching, reports) is never part of the score. Coding results are scored separately, from test results only.
      </p>
    </section>
  )
}
