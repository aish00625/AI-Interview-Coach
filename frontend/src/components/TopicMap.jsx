const STATUS_TEXT = { weak: 'Weak', developing: 'Developing', strong: 'Strong', insufficient_data: 'Insufficient data', no_data: 'Not practised' }

/**
 * Knowledge-gap map: topics grouped by subject (DSA / CS fundamentals), each tile showing its standing and the evidence
 * behind it. Status is written out as text on every tile (colour is only a second cue).
 */
export default function TopicMap({ subjects, thresholds }) {
  if (!subjects || !subjects.length) return null
  return (
    <div className="stack" style={{ gap: 18 }}>
      {subjects.map((g) => (
        <div key={g.subject}>
          <div className="small muted" style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{g.subject}</div>
          <div className="topic-grid">
            {g.topics.map((t) => (
              <div key={t.topic} className={`topic-tile topic-${t.status}`} title={t.evidence}>
                <div className="topic-name">{t.topic}</div>
                <div className="topic-score">{t.score == null ? '—' : `${t.score}%`}</div>
                <div className="topic-evidence">
                  {STATUS_TEXT[t.status]}{t.confidence ? ` · ${t.confidence} confidence` : ''}
                  {t.interviewUnscored > 0 && ` · ${t.interviewUnscored} not answered / not evaluable (left out)`}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {thresholds && (
        <p className="small muted" style={{ margin: 0 }}>
          Weak is below {thresholds.weakBelow}%, developing below {thresholds.developingBelow}%, strong from there up. A topic needs at least {thresholds.minimumDataPoints} data points before it is judged. These cut-offs are rules of thumb, not validated measurements.
        </p>
      )}
    </div>
  )
}
