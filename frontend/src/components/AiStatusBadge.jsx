import { useEffect, useState } from 'react'
import Badge from './Badge.jsx'
import { dashboardApi } from '../services/api.js'

const TEXT = {
  ready: { tone: 'success', label: 'Local AI ready', help: null },
  model_missing: { tone: 'warning', label: 'AI model not installed', help: null },
  unreachable: { tone: 'warning', label: 'Local AI is off', help: 'Start Ollama to enable AI follow-ups, STAR coaching and the coding coach. Everything else works without it.' },
  disabled: { tone: 'muted', label: 'Local AI disabled', help: 'LLM_ENABLED is false, so rule-based feedback is used.' },
  error: { tone: 'warning', label: 'Local AI problem', help: null },
  unknown: { tone: 'muted', label: 'Local AI status unknown', help: 'The AI service could not be reached. Rule-based feedback is used meanwhile.' },
}

/** Small status pill for the optional local model. Renders nothing until the first answer; never blocks the page. */
export default function AiStatusBadge({ showHelp = false }) {
  const [s, setS] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    dashboardApi.getAiStatus().then((d) => !cancelled && setS(d)).catch(() => !cancelled && setS({ state: 'unknown' }))
    return () => { cancelled = true }
  }, [tick])
  if (!s) return null
  const t = TEXT[s.state] || TEXT.unknown
  const help = s.message || t.help
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Badge tone={t.tone} title={help || undefined}>{t.label}{s.state === 'ready' && s.model ? ` · ${s.model}` : ''}</Badge>
      {s.state !== 'ready' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTick((n) => n + 1)}>Check again</button>}
      {showHelp && help && s.state !== 'ready' && <span className="small muted">{help}</span>}
    </span>
  )
}
