/**
 * Delivery feedback for one answer (private practice only): speech measurements, typing measurements and the advisory
 * delivery score built from them. Everything shown is a count, timing or ratio. The panel never talks about emotion,
 * confidence or honesty, and it says so. Its measured parts feed the practice final score only through the weighted breakdown.
 */
const muted = { color: 'var(--text-500)' }
const pct = (v) => `${Math.round(v * 100)}%`
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString()

function Bar({ score }) {
  return (
    <div role="img" aria-label={`${score} out of 100`} style={{ height: 6, borderRadius: 3, background: 'var(--border-400, #444)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: '100%', background: 'var(--accent, #6c8cff)' }} />
    </div>
  )
}

/** Speech measurements. Works for old (schema v1) and new (v2) stored metrics; absent values are simply not shown. */
export function SpeechMetricsView({ metrics: m }) {
  if (!m) return null
  const badge = (label, value) => (value == null ? null : <span className="badge" key={label}>{label}: {value}</span>)
  const conf = m.transcriptConfidence
  const aq = m.audioQuality
  return (
    <div>
      <h4>Speech measurements</h4>
      {conf && conf.level && conf.level !== 'unknown' && (
        <p role={conf.level === 'low' ? 'alert' : undefined} style={{ margin: '0 0 8px', fontSize: '0.82rem', ...(conf.level === 'low' ? {} : muted) }}>
          <strong>Transcript confidence: {conf.level}.</strong>{' '}
          {conf.level === 'low'
            ? 'The speech recogniser was unsure about much of this recording, so the transcript (and the scores based on it) may not match what you said. Read it and re-record if it looks wrong.'
            : 'This is the recogniser’s own certainty, not a measured accuracy figure; always skim the transcript.'}
        </p>
      )}
      {m.reliable === false && Array.isArray(m.unreliableReasons) && m.unreliableReasons.length > 0 && (
        <p style={{ margin: '0 0 8px', fontSize: '0.82rem', ...muted }}>Some measurements below are less reliable: {m.unreliableReasons.join('; ')}.</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {badge('Duration', m.durationSeconds != null ? `${num(m.durationSeconds)}s` : null)}
        {badge('Words', m.wordCount)}
        {badge('Speaking rate', m.speakingRateWpm != null ? `${num(m.speakingRateWpm, 0)} WPM` : null)}
        {badge('Articulation rate', m.articulationRateWpm != null ? `${num(m.articulationRateWpm, 0)} WPM` : null)}
        {badge('Filler words', m.fillerWordCount)}
        {badge('Fillers / false starts per 100 words', m.disfluencyRatePer100Words != null ? num(m.disfluencyRatePer100Words) : null)}
        {badge('Pauses', m.pauseCount)}
        {badge('Avg pause', m.averagePauseSeconds != null ? `${num(m.averagePauseSeconds, 2)}s` : null)}
        {badge('Long pauses (2s+)', m.longPauseCount)}
        {badge('Longest pause', m.longestPauseSeconds != null ? `${num(m.longestPauseSeconds)}s` : null)}
        {badge('Time to first word', m.timeToFirstWordSeconds != null ? `${num(m.timeToFirstWordSeconds)}s` : null)}
      </div>
      {m.fillerWords && Object.keys(m.fillerWords).length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '0.82rem', ...muted }}>
          {Object.entries(m.fillerWords).map(([word, count]) => `"${word}" ×${count}`).join('  ·  ')}
        </p>
      )}
      {aq && aq.verdict && aq.verdict !== 'ok' && (
        <p style={{ margin: '8px 0 0', fontSize: '0.82rem', ...muted }}>Recording quality note: {Array.isArray(aq.issues) && aq.issues.length ? aq.issues.join(' ') : String(aq.verdict)}</p>
      )}
      {Array.isArray(m.notes) && m.notes.map((n, i) => <p key={i} style={{ margin: '6px 0 0', fontSize: '0.78rem', ...muted }}>{n}</p>)}
    </div>
  )
}

export function TypingMetricsView({ metrics: t }) {
  if (!t) return null
  const badge = (label, value) => (value == null ? null : <span className="badge" key={label}>{label}: {value}</span>)
  return (
    <div>
      <h4>Typing measurements</h4>
      <p style={{ margin: '0 0 8px', fontSize: '0.78rem', ...muted }}>Only counts and timings are recorded, never which keys you pressed.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {badge('Typing speed', t.typingSpeedWpm != null ? `${num(t.typingSpeedWpm)} WPM` : null)}
        {badge('Characters typed', t.typedChars)}
        {badge('Deletions', t.correctionRatio != null ? pct(t.correctionRatio) + ' of key presses' : null)}
        {badge('Long pauses (3s+)', t.longPauseCount)}
        {badge('Longest pause', t.longestPauseMs ? `${num(t.longestPauseMs / 1000)}s` : null)}
        {badge('Pasted', t.pasteShare != null && t.pasteShare > 0 ? pct(t.pasteShare) + ' of the answer' : null)}
        {badge('Time before first key', t.timeToFirstKeyMs != null ? `${num(t.timeToFirstKeyMs / 1000)}s` : null)}
      </div>
      {Array.isArray(t.notes) && t.notes.map((n, i) => <p key={i} style={{ margin: '6px 0 0', fontSize: '0.78rem', ...muted }}>{n}</p>)}
    </div>
  )
}

/** The advisory delivery score and what it was made from. Hidden when there is no behaviour summary (e.g. hiring assessments). */
export default function DeliveryPanel({ summary }) {
  if (!summary) return null
  return (
    <div style={{ marginBottom: 14 }}>
      <h4>Delivery feedback <span className="badge" style={{ marginLeft: 6 }}>advisory</span></h4>
      {summary.score != null ? (
        <p style={{ margin: '0 0 8px', fontSize: '1.05rem' }}><strong>{summary.score}</strong> / 100 <span style={{ fontSize: '0.8rem', ...muted }}>delivery score (its measured parts count toward your final score; see the breakdown)</span></p>
      ) : (
        <p style={{ margin: '0 0 8px', fontSize: '0.88rem', ...muted }}>No delivery score for this answer.</p>
      )}
      {summary.components.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {summary.components.map((c) => (
            <div key={c.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}><span>{c.label}</span><span>{c.score}</span></div>
              <Bar score={c.score} />
              <div style={{ fontSize: '0.76rem', marginTop: 3, ...muted }}>{c.detail}</div>
            </div>
          ))}
        </div>
      )}
      {summary.limitations.map((l, i) => <p key={i} style={{ margin: '8px 0 0', fontSize: '0.78rem', ...muted }}>{l}</p>)}
      <p style={{ margin: '8px 0 0', fontSize: '0.78rem', ...muted }}>{summary.note}</p>
    </div>
  )
}

/** Session-level roll-up shown next to the final score. */
export function SessionDelivery({ delivery }) {
  if (!delivery) return null
  return (
    <div style={{ margin: '0 0 24px', maxWidth: 420 }}>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: '0.78rem', ...muted }}>Delivery score (advisory)</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{delivery.score != null ? `${delivery.score} / 100` : '—'}</div>
        <div style={{ fontSize: '0.76rem', ...muted }}>
          {delivery.score != null ? `Average over ${delivery.answersScored} of ${delivery.answersTotal} answers with enough measurable signals. ` : 'Not enough measurable signals in this session. '}
          Not part of the final score; never shown to employers.
        </div>
        {Array.isArray(delivery.components) && delivery.components.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {delivery.components.map((c) => (
              <div key={c.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}><span>{c.label}</span><span>{c.score}</span></div>
                <Bar score={c.score} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Content + delivery in one plain-language practice summary (from GET /interviews/:id -> combinedSummary). Rule-based, advisory. */
export function CombinedSummary({ summary }) {
  if (!summary) return null
  return (
    <section className="panel" style={{ margin: '0 0 24px' }} aria-label="Content and delivery summary">
      <div className="panel-header">
        <h2 className="panel-title">Content and delivery</h2>
        <span className="badge badge-muted" title="Built by fixed rules from measured numbers.">Rule-based · advisory</span>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '0 0 10px' }}>
        <div><div style={{ fontSize: '0.78rem', ...muted }}>Content</div><div style={{ fontSize: '1.3rem', fontWeight: 600 }}>{summary.contentScore} / 100</div></div>
        <div><div style={{ fontSize: '0.78rem', ...muted }}>Delivery</div><div style={{ fontSize: '1.3rem', fontWeight: 600 }}>{summary.deliveryScore} / 100</div></div>
      </div>
      <p style={{ margin: '0 0 10px' }}>{summary.text}</p>
      {summary.tips.length > 0 && (
        <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: 'var(--text-300)' }}>
          {summary.tips.map((t) => (
            <li key={t.key} style={{ marginBottom: 6 }}>
              <strong>{t.label} ({t.score}):</strong> {t.tip}
              {t.measured && <span style={{ fontSize: '0.8rem', ...muted }}> Measured: {t.measured}</span>}
            </li>
          ))}
        </ul>
      )}
      <p style={{ margin: 0, fontSize: '0.78rem', ...muted }}>{summary.note}</p>
    </section>
  )
}
