import { useEffect, useState } from 'react'
import Panel from './Panel.jsx'
import Button from './Button.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import AiSourceBadge from './AiSourceBadge.jsx'
import { interviewApi } from '../services/api.js'
import { describeAiError } from '../utils/aiErrors.js'

function List({ title, items }) {
  if (!items || !items.length) return null
  return (
    <div>
      <h4>{title}</h4>
      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-300)' }}>{items.map((x, i) => <li key={i} style={{ marginBottom: 4 }}>{x}</li>)}</ul>
    </div>
  )
}

/** Extra report sections built only from the session's real data (no new AI call). */
function ReportDetails({ summary, speech, typing, camera }) {
  const c = summary.counts
  const dims = summary.dimensions.map((x) => `${x.label}: ${x.average === null ? 'insufficient data' : `${x.average}/100`}`).join(' · ')
  const obs = []
  if (speech) {
    if (speech.speakingRateWpm !== null) obs.push(`Speaking rate averaged ${speech.speakingRateWpm} words/min.`)
    if (speech.fillerWords !== null) obs.push(`${speech.fillerWords} filler word${speech.fillerWords === 1 ? '' : 's'} detected.`)
    if (speech.pauses !== null) obs.push(`${speech.pauses} pause${speech.pauses === 1 ? '' : 's'} detected.`)
  } else obs.push('No speech was measured in this session.')
  if (typing && typing.typingSpeedWpm !== null) obs.push(`Typing speed averaged ${typing.typingSpeedWpm} words/min.`)
  if (camera) {
    const pc = (v) => `${Math.round(v.value * 100)}%`
    if (camera.facePresence) obs.push(`Face visible in ${pc(camera.facePresence)} of sampled frames.`)
    if (camera.facingCamera) obs.push(`Facing the camera in ${pc(camera.facingCamera)} of sampled frames.`)
    if (camera.eyeContact) obs.push(`Approximate eye contact ${pc(camera.eyeContact)}.`)
    obs.push('Camera figures are measurements only, not a judgement of honesty, emotion or attention.')
  } else obs.push('Camera analysis was not used in this session.')
  const topics = summary.weakTopics.map((t) => `${t.topic} (average ${t.average}/100)`)
  return (
    <div className="report-details" style={{ marginTop: 16, display: 'grid', gap: 14 }}>
      <div>
        <h4>Performance breakdown</h4>
        <p className="small" style={{ margin: 0 }}>
          {c.evaluated} of {c.total} questions evaluated{c.skipped ? `, ${c.skipped} skipped` : ''}{c.notEvaluable ? `, ${c.notEvaluable} not evaluable` : ''}.
          {summary.overallAverage !== null ? ` Average ${summary.overallAverage}/100.` : ''} {dims}.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <List title="Strong and weak areas" items={[
          summary.strongest ? `Strongest: ${summary.strongest.label} (${summary.strongest.average}/100)` : null,
          summary.weakest ? `Weakest: ${summary.weakest.label} (${summary.weakest.average}/100)` : null,
        ].filter(Boolean)} />
        <List title="Topic recommendations" items={topics.length ? topics.map((t) => `Revise ${t}`) : ['No topic averaged below 60/100.']} />
        <List title="Speech and facial observations" items={obs} />
        <List title="Practice plan" items={[...summary.nextSteps, summary.suggestedNext]} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>Question-by-question feedback for every question is in the answer table above and in the printed report.</p>
    </div>
  )
}

/** Final written feedback report for a completed practice interview. Generated on request, saved, labelled by source. */
export default function AiReportPanel({ sessionId, summary = null, speech = null, typing = null, camera = null }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })

  useEffect(() => {
    let cancelled = false
    interviewApi.getAiReport(sessionId)
      .then((d) => !cancelled && setState({ status: d.saved ? 'ready' : 'idle', data: d.saved ? d : null, error: '' }))
      .catch(() => !cancelled && setState({ status: 'idle', data: null, error: '' }))
    return () => { cancelled = true }
  }, [sessionId])

  async function run() {
    setState((s) => ({ ...s, status: 'running', error: '' }))
    try {
      setState({ status: 'ready', data: await interviewApi.generateAiReport(sessionId), error: '' })
    } catch (err) {
      setState((s) => ({ status: s.data ? 'ready' : 'idle', data: s.data, error: describeAiError(err, 'Could not write the report. Please try again.').message }))
    }
  }

  const d = state.data
  const r = d && d.report
  return (
    <Panel title="Interview feedback report" aside={d ? <AiSourceBadge source={d.source} model={d.model} /> : null}>
      {state.status === 'loading' && <LoadingSpinner label="Checking for a saved report..." />}
      {state.status === 'idle' && (
        <div>
          <p className="muted" style={{ margin: '0 0 12px' }}>A short written summary of the whole interview: what went well, what to improve and what to practise next. It uses only your own answers and scores.</p>
          <Button onClick={run}>Write my report</Button>
        </div>
      )}
      {state.status === 'running' && <LoadingSpinner label="Writing your report (the local model can take up to a minute)..." />}
      {r && state.status !== 'running' && (
        <div>
          {d.aiUnavailable && <p className="small muted" role="status" style={{ margin: '0 0 10px' }}>{d.aiUnavailable.message || 'The local AI model was not available'} - this report was built from your scores with fixed rules.</p>}
          <p style={{ margin: '0 0 14px' }}>{r.summary}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <List title="Strengths" items={r.strengths} />
            <List title="To improve" items={r.improvements} />
            <List title="Next steps" items={r.nextSteps} />
          </div>
          {summary && <ReportDetails summary={summary} speech={speech} typing={typing} camera={camera} />}
          <p className="small muted" style={{ margin: '12px 0 0' }}>{d.advisory}</p>
          <div style={{ marginTop: 8 }}><Button variant="secondary" size="sm" onClick={run}>{d.source === 'rule_based' ? 'Try with the local AI again' : 'Write it again'}</Button></div>
        </div>
      )}
      {state.error && <div role="alert" className="notice notice-info" style={{ marginTop: 10 }}>{state.error}</div>}
    </Panel>
  )
}
