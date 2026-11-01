import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Panel from './Panel.jsx'
import Badge from './Badge.jsx'
import Button from './Button.jsx'
import { Skeleton } from './Skeleton.jsx'
import AiStatusBadge from './AiStatusBadge.jsx'
import { dashboardApi } from '../services/api.js'

/** Today's practice plan. Built from the candidate's real records by fixed rules; each task states its reason. */
export default function DailyPlanPanel() {
  const [state, setState] = useState({ status: 'loading', plan: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading' }))
    dashboardApi.getPlan()
      .then((plan) => !cancelled && setState({ status: 'ok', plan }))
      .catch(() => !cancelled && setState({ status: 'error', plan: null }))
    return () => { cancelled = true }
  }, [tick])

  const plan = state.plan
  return (
    <Panel title="Today's practice plan" aside={plan ? <Badge tone="muted" title="Built by fixed rules from your own records.">Rule-based</Badge> : null}>
      {state.status === 'loading' && <Skeleton height={90} />}
      {state.status === 'error' && (
        <div>
          <p className="muted" style={{ margin: '0 0 10px' }}>Could not load your plan.</p>
          <Button variant="secondary" size="sm" onClick={() => setTick((n) => n + 1)}>Try again</Button>
        </div>
      )}
      {plan && (
        <div>
          <p className="small muted" style={{ margin: '0 0 10px' }}>{plan.intro}</p>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
            {plan.tasks.map((t) => (
              <li key={t.id} style={{ border: '1px solid var(--border-500)', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <Link to={t.link}><strong>{t.title}</strong></Link>
                  <span className="small muted">~{t.suggestedMinutes} min</span>
                </div>
                <p className="small" style={{ margin: '4px 0 0', color: 'var(--text-300)' }}>{t.reason}</p>
              </li>
            ))}
          </ol>
          <p className="small muted" style={{ margin: '10px 0 0' }}>About {plan.totalMinutes} minutes in total. Durations are suggestions.</p>
        </div>
      )}
      <div style={{ marginTop: 10 }}><AiStatusBadge showHelp /></div>
    </Panel>
  )
}
