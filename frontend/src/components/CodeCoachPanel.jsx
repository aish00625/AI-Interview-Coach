import { useState } from 'react'
import Panel from './Panel.jsx'
import Button from './Button.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import AiSourceBadge from './AiSourceBadge.jsx'
import RunResults from './RunResults.jsx'
import { codingApi } from '../services/api.js'
import { describeAiError } from '../utils/aiErrors.js'

/**
 * "Coach me": runs the sample tests in the code executor (the only authority on pass/fail) and shows advisory
 * explanations beside the real result. Nothing is saved or submitted, and hidden tests are never involved.
 */
export default function CodeCoachPanel({ problemId, language, code }) {
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true); setError('')
    try {
      setOut(await codingApi.coach({ problemId, language, sourceCode: code }))
    } catch (err) {
      const s = err.response?.status
      if (s === 503 && !err.response?.data?.reason) setError('The code execution service is unavailable, so there is nothing to coach yet. (This does not mean your code failed.)')
      else if (s === 429) setError(err.response?.data?.message || 'Too many requests. Please wait a moment.')
      else setError(describeAiError(err, 'Could not coach this attempt. Please try again.').message)
    } finally { setBusy(false) }
  }

  const c = out && out.coaching
  return (
    <Panel title="Coding coach" aside={c ? <AiSourceBadge source={c.source} model={c.model} /> : null} style={{ marginTop: 16 }}>
      <p className="small muted" style={{ margin: '0 0 10px' }}>Runs your code on the sample tests, then explains what went wrong and suggests hints. Hints are nudges, not solutions. Pass or fail always comes from actually running your code. Nothing is submitted.</p>
      <Button variant="secondary" onClick={run} disabled={busy || !code.trim()}>{busy ? 'Coaching...' : out ? 'Coach me again' : 'Coach me'}</Button>
      {busy && <div style={{ marginTop: 10 }}><LoadingSpinner label="Running the sample tests, then asking the coach (up to a minute)..." /></div>}
      {error && <div role="alert" className="notice notice-info" style={{ marginTop: 10 }}>{error} <Button variant="secondary" size="sm" onClick={run} disabled={busy}>Try again</Button></div>}

      {out && !busy && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ margin: '0 0 6px' }}>Test result <span className="small muted">(from running your code)</span></h4>
          <RunResults result={out.run} />

          <h4 style={{ margin: '16px 0 6px' }}>Coach&apos;s notes <span className="small muted">(advisory)</span></h4>
          {out.aiUnavailable && <p className="small muted" role="status" style={{ margin: '0 0 8px' }}>{out.aiUnavailable.message || 'The local AI model was not available.'} Showing the built-in test explanation only.</p>}
          {c.summary && <p style={{ margin: '0 0 8px' }}>{c.summary}</p>}
          {c.failureExplanation && <p style={{ margin: '0 0 8px', color: 'var(--text-300)' }}><strong>Why it may be failing:</strong> {c.failureExplanation}</p>}
          {c.hints && c.hints.length > 0 && (
            <div style={{ marginBottom: 8 }}><strong>Hints</strong><ol style={{ margin: '4px 0 0', paddingLeft: 20, color: 'var(--text-300)' }}>{c.hints.map((h, i) => <li key={i}>{h}</li>)}</ol></div>
          )}
          {c.edgeCases && c.edgeCases.length > 0 && (
            <div style={{ marginBottom: 8 }}><strong>Edge cases to check</strong><ul style={{ margin: '4px 0 0', paddingLeft: 20, color: 'var(--text-300)' }}>{c.edgeCases.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
          )}
          {c.complexity && (c.complexity.time || c.complexity.space) && (
            <p style={{ margin: '0 0 8px', color: 'var(--text-300)' }}>
              <strong>Complexity (estimate):</strong> time {c.complexity.time || '?'}, space {c.complexity.space || '?'}
              {c.complexity.note ? <span className="small muted"> - {c.complexity.note}</span> : null}
            </p>
          )}
          <p className="small muted" style={{ margin: 0 }}>{c.advisory}</p>
        </div>
      )}
    </Panel>
  )
}
