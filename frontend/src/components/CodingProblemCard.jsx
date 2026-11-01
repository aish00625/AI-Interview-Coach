import { Link } from 'react-router-dom'
import Badge from './Badge.jsx'

const STATUS = { solved: { tone: 'success', text: 'Solved' }, attempted: { tone: 'warning', text: 'Attempted' } }

/** problem: { id, title, topic, difficulty, shortDescription, status?: 'solved' | 'attempted', attempts? } */
export default function CodingProblemCard({ problem }) {
  const st = STATUS[problem.status]
  return (
    <Link to={`/coding/${problem.id}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ height: '100%' }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="badge">{problem.topic}</span>
          <span className={`badge badge-${problem.difficulty}`}>{problem.difficulty}</span>
        </div>
        <h4 style={{ color: 'var(--text-100)' }}>{problem.title}</h4>
        <p style={{ fontSize: '0.85rem', margin: '0 0 10px' }}>{problem.shortDescription}</p>
        {st ? <Badge tone={st.tone}>{st.text}{problem.attempts > 1 ? ` · ${problem.attempts} tries` : ''}</Badge> : <span className="small muted">Not started</span>}
      </div>
    </Link>
  )
}
