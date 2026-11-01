import { useEffect, useState } from 'react'
import Panel from './Panel.jsx'
import Badge from './Badge.jsx'
import { interviewApi } from '../services/api.js'

const LABELS = { technical: 'Technical', relevance: 'Relevance', clarity: 'Clarity', completeness: 'Completeness' }

function Change({ value }) {
  if (value == null) return <span className="muted">—</span>
  if (value === 0) return <Badge tone="muted">no change</Badge>
  return <Badge tone={value > 0 ? 'success' : 'warning'}>{value > 0 ? '+' : ''}{value}</Badge>
}

/**
 * This interview against the candidate's previous completed one of the same type and role (GET /interviews/:id/comparison,
 * own sessions only). Differences are shown as plain changes in average score; the panel states plainly that different
 * questions may have been asked. Renders nothing while loading or if the request fails - it is an extra, not core.
 */
export default function ComparisonPanel({ sessionId }) {
  const [state, setState] = useState({ status: 'loading', data: null })

  useEffect(() => {
    let cancelled = false
    interviewApi.getComparison(sessionId)
      .then((data) => !cancelled && setState({ status: 'ok', data }))
      .catch(() => !cancelled && setState({ status: 'error', data: null }))
    return () => { cancelled = true }
  }, [sessionId])

  if (state.status !== 'ok') return null
  const c = state.data

  if (!c.available) {
    return (
      <Panel title="Compared with your previous attempt">
        <p className="muted" style={{ margin: 0 }}>{c.reason}</p>
      </Panel>
    )
  }
  return (
    <Panel title="Compared with your previous attempt" aside={<Badge tone={c.scoreChange > 0 ? 'success' : c.scoreChange < 0 ? 'warning' : 'muted'}>{c.scoreChange > 0 ? '+' : ''}{c.scoreChange ?? '—'} overall</Badge>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Previous interview #{c.previous.id}: {c.previous.finalScore ?? '—'}/100 · this one: {c.current.finalScore ?? '—'}/100.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Average score</th><th>Previous</th><th>This time</th><th>Change</th></tr></thead>
          <tbody>
            {c.dimensions.map((d) => (
              <tr key={d.dimension}><td>{LABELS[d.dimension]}</td><td>{d.previous ?? '—'}</td><td>{d.current ?? '—'}</td><td><Change value={d.change} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.topics.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Topics asked both times (technical score)</div>
          {c.topics.map((t) => (
            <div key={t.topic} className="row-between small" style={{ padding: '3px 0' }}><span>{t.topic}: {t.previous} → {t.current}</span><Change value={t.change} /></div>
          ))}
        </div>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>{c.note}</p>
    </Panel>
  )
}
