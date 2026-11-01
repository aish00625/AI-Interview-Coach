import { useEffect, useState } from 'react'
import Card from './Card.jsx'
import Button from './Button.jsx'
import { codingApi } from '../services/api.js'

/** Tiered hints, revealed one at a time. The server withholds them entirely for problems in an active job assessment. */
export default function HintsPanel({ problemId, hintCount, disabledByAssessmentContext }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hintCount || disabledByAssessmentContext) return
    let cancelled = false
    codingApi.getHints(problemId).then((s) => { if (!cancelled) setState(s) }).catch(() => { if (!cancelled) setError('Could not load hints.') })
    return () => { cancelled = true }
  }, [problemId, hintCount, disabledByAssessmentContext])

  if (!hintCount) return null
  if (disabledByAssessmentContext || state?.locked) {
    return <Card style={{ marginTop: 14 }}><p style={{ margin: 0, color: 'var(--text-500)' }}>Hints are not available for job assessment problems.</p></Card>
  }

  async function next() {
    setBusy(true); setError('')
    try { setState(await codingApi.revealNextHint(problemId)) } catch (err) {
      setError(err.response?.data?.message || 'Could not reveal the next hint.')
    } finally { setBusy(false) }
  }

  const revealed = state?.revealed || []
  const remaining = (state?.total ?? hintCount) - revealed.length
  return (
    <Card style={{ marginTop: 14 }}>
      <h4 style={{ margin: '0 0 8px' }}>Hints</h4>
      {revealed.length === 0 && <p style={{ margin: '0 0 8px', color: 'var(--text-500)' }}>Try the problem first. Hints go from a gentle nudge to a more specific direction, one at a time.</p>}
      <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
        {revealed.map((h) => <li key={h.level} style={{ marginBottom: 4 }}>{h.text}</li>)}
      </ol>
      {remaining > 0 && <Button variant="secondary" onClick={next} disabled={busy || !state}>{busy ? 'Loading...' : `Show hint ${revealed.length + 1} of ${state?.total ?? hintCount}`}</Button>}
      {error && <div className="field-error" style={{ marginTop: 8 }}>{error}</div>}
    </Card>
  )
}
