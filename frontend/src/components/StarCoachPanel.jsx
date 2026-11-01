import { useEffect, useState } from 'react'
import Button from './Button.jsx'
import Badge from './Badge.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import AiSourceBadge from './AiSourceBadge.jsx'
import { interviewApi } from '../services/api.js'
import { describeAiError } from '../utils/aiErrors.js'

const PARTS = [['situation', 'Situation'], ['task', 'Task'], ['action', 'Action'], ['result', 'Result']]
const TONE = { present: 'success', weak: 'warning', missing: 'danger' }
const LABEL = { present: 'Clear', weak: 'Needs detail', missing: 'Not found' }

/**
 * STAR (Situation, Task, Action, Result) coaching for one answered question. Saved after the first run, so reopening
 * the page costs nothing. Evidence quotes are taken from the candidate's own answer; they are advisory, not a verdict.
 */
export default function StarCoachPanel({ sessionId, questionId }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })

  useEffect(() => {
    let cancelled = false
    interviewApi.getStar(sessionId, questionId)
      .then((d) => !cancelled && setState({ status: d.saved ? 'ready' : 'idle', data: d.saved ? d : null, error: '' }))
      .catch(() => !cancelled && setState({ status: 'idle', data: null, error: '' }))
    return () => { cancelled = true }
  }, [sessionId, questionId])

  async function run() {
    setState((s) => ({ ...s, status: 'running', error: '' }))
    try {
      const d = await interviewApi.generateStar(sessionId, questionId)
      setState({ status: 'ready', data: d, error: '' })
    } catch (err) {
      setState((s) => ({ status: s.data ? 'ready' : 'idle', data: s.data, error: describeAiError(err, 'Could not analyse this answer. Please try again.').message }))
    }
  }

  const d = state.data
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-500)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>STAR coaching</h4>
        {d && <AiSourceBadge source={d.source} model={d.model} />}
      </div>

      {state.status === 'loading' && <LoadingSpinner label="Checking for saved coaching..." />}

      {state.status === 'idle' && (
        <div>
          <p className="small muted" style={{ margin: '0 0 10px' }}>Behavioural answers work best in the Situation - Task - Action - Result shape. Check which parts of this answer are clear and which need more detail.</p>
          <Button variant="secondary" size="sm" onClick={run}>Analyse with STAR</Button>
        </div>
      )}

      {state.status === 'running' && <LoadingSpinner label="Analysing your answer (the local model can take up to a minute)..." />}

      {d && state.status !== 'running' && (
        <div>
          {d.aiUnavailable && <p className="small muted" role="status" style={{ margin: '0 0 10px' }}>{d.aiUnavailable.message || 'The local AI model was not available'} - this is the simpler rule-based check.</p>}
          {d.overall && <p style={{ margin: '0 0 12px' }}>{d.overall}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {PARTS.map(([key, name]) => {
              const el = d.elements?.[key]
              if (!el) return null
              return (
                <div key={key} style={{ border: '1px solid var(--border-500)', borderRadius: 8, padding: 12 }}>
                  <p style={{ margin: '0 0 6px' }}><strong>{name}</strong>{' '}<Badge tone={TONE[el.status] || 'muted'}>{LABEL[el.status] || el.status}</Badge></p>
                  {el.evidence && <p className="small" style={{ margin: '0 0 6px', fontStyle: 'italic', color: 'var(--text-300)' }}>&ldquo;{el.evidence}&rdquo;</p>}
                  {el.suggestion && <p className="small" style={{ margin: 0, color: 'var(--text-300)' }}>{el.suggestion}</p>}
                </div>
              )
            })}
          </div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>{d.note || 'Advisory feedback.'}</p>
          <div style={{ marginTop: 8 }}><Button variant="secondary" size="sm" onClick={run}>{d.source === 'rule_based' ? 'Try with the local AI again' : 'Re-run analysis'}</Button></div>
        </div>
      )}

      {state.error && <div role="alert" className="notice notice-info" style={{ marginTop: 10 }}>{state.error}</div>}
    </div>
  )
}
