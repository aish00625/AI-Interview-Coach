import { useState } from 'react'
import Badge from './Badge.jsx'
import { CATEGORY_META, eventLine, filterEvents } from '../utils/faceMonitor.js'

const FILTERS = [['all', 'All'], ['review_recommended', 'Review suggested'], ['warning', 'Warnings'], ['observation', 'Observations'], ['technical_issue', 'Technical']]

/** Newest first. Every event shows category, time, duration, confidence (or "Not available"), why it was raised, and whether it is ongoing. */
export default function FaceEventTimeline({ events, now }) {
  const [filter, setFilter] = useState('all')
  const shown = filterEvents(events || [], filter)
  return (
    <div>
      <div role="group" aria-label="Filter events" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p style={{ color: 'var(--text-500)', margin: 0 }}>{(events || []).length === 0 ? 'No events yet. Events appear here only when something lasts longer than a short threshold.' : 'No events in this filter.'}</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label="Event timeline">
          {shown.map((e) => {
            const l = eventLine(e, now)
            return (
              <li key={e.id} className="notice" data-category={e.category} data-status={e.status}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{l.title}</strong>
                  <Badge tone={l.category.tone} title={l.category.blurb}>{l.category.label}</Badge>
                  <Badge tone={e.status === 'ongoing' ? 'info' : 'neutral'}>{l.stateLabel}</Badge>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-500)' }}>{l.meta} · {l.duration}</span>
                </div>
                <div style={{ marginTop: 4 }}>{e.explanation}</div>
                <div style={{ marginTop: 2, color: 'var(--text-500)', fontSize: '0.8rem' }}>Confidence: {l.confidence}{e.category === 'review_recommended' ? ' · A prompt for a person to look, not a finding of misconduct.' : ''}</div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
export { CATEGORY_META }
