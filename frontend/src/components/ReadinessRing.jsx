import Panel from './Panel.jsx'
import Badge from './Badge.jsx'

/**
 * Practice-readiness card. Shows the score only when the API provides one, lists exactly which signals went into it,
 * and always carries the limitations - it is a practice indicator, never a prediction of interview outcomes.
 */
export default function ReadinessRing({ readiness }) {
  const has = readiness && readiness.score != null
  const tone = !has ? 'muted' : readiness.score >= 70 ? 'success' : readiness.score >= 40 ? 'info' : 'warning'
  return (
    <Panel title="Practice readiness" hero aside={has ? <Badge tone={tone}>{readiness.band}</Badge> : null}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="ring" style={{ '--pct': has ? readiness.score : 0 }} aria-label={has ? `Readiness ${readiness.score} out of 100` : 'Readiness not available yet'}>
          <div className="ring-inner">
            <div>
              <div className="ring-value">{has ? readiness.score : '—'}</div>
              <div className="ring-caption">{has ? 'out of 100' : 'no data yet'}</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          {!has && <p style={{ marginTop: 0 }}>{readiness?.reason}</p>}
          {has && <p className="small muted" style={{ marginTop: 0 }}>Based on {readiness.basedOn} of {readiness.of} signals with enough data. Signals without enough data are left out, not counted as zero.</p>}
          <div className="stack" style={{ gap: 10 }}>
            {(readiness?.components || []).map((c) => (
              <div key={c.key}>
                <div className="row-between small">
                  <span>{c.label} <span className="muted">· {Math.round(c.weight * 100)}% weight</span></span>
                  <span className="mono">{c.available ? `${c.value}%` : 'not enough data'}</span>
                </div>
                <div className="meter" aria-hidden="true"><span style={{ width: `${c.available ? c.value : 0}%`, opacity: c.available ? 1 : 0.3 }} /></div>
                <div className="small muted" style={{ marginTop: 2 }}>{c.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <details className="disclosure" style={{ marginTop: 14 }}>
        <summary>How is this calculated, and what are its limits?</summary>
        <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {(readiness?.limitations || []).map((l) => <li key={l}>{l}</li>)}
        </ul>
      </details>
    </Panel>
  )
}
