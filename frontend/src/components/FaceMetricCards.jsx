import Badge from './Badge.jsx'
import { cardView } from '../utils/faceMonitor.js'

/** The eight face-behaviour metric cards. A card that was not measured shows its state in words and no number. */
export default function FaceMetricCards({ cards }) {
  if (!cards || !cards.length) return null
  return (
    <div className="face-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }} role="list" aria-label="Face behaviour measurements">
      {cards.map((c) => {
        const v = cardView(c)
        return (
          <article key={v.key} className="stat-card" role="listitem" data-card={v.key} data-state={c.availability}>
            <div className="stat-label">{v.label} <Badge tone={v.tone}>{v.stateLabel}</Badge></div>
            <div style={{ fontSize: c.availability === 'measured' ? '1.05rem' : '0.95rem', fontWeight: 600, color: c.availability === 'measured' ? 'var(--text-100)' : 'var(--text-500)' }}>{v.headline}</div>
            {v.lines.map((l) => <div key={l} className="stat-hint">{l}</div>)}
            <div className="stat-hint">{v.explanation}</div>
            {v.limitations.map((l) => <div key={l} className="stat-hint" style={{ fontStyle: 'italic' }}>{l}</div>)}
          </article>
        )
      })}
    </div>
  )
}
