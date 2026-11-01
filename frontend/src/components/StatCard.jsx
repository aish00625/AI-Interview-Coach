import { Link } from 'react-router-dom'

/**
 * One headline number. `value` null/undefined renders an em dash (never a fabricated 0); `to` makes the whole card a link
 * so dashboard cards navigate to the relevant details.
 */
export default function StatCard({ label, value, unit = '', hint = null, to = null, accent = 'amber' }) {
  const shown = value === null || value === undefined ? '—' : value
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {shown}
        {unit && shown !== '—' && <span className="unit">{unit}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  )
  const cls = `stat-card stat-accent-${accent}`
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}
