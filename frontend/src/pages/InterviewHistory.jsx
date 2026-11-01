import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState.jsx'
import Card from '../components/Card.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { interviewApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

/**
 * The candidate's private practice interviews, from GET /api/interviews. The server already excludes
 * job assessments (those are listed under My applications), so nothing here is shared with hirers.
 * Completed sessions open the results page; anything else resumes the live session.
 */
export default function InterviewHistory() {
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    interviewApi.getInterviews()
      .then((rows) => { if (!cancelled) setSessions(Array.isArray(rows) ? rows : []) })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, 'Could not load your interview history.')) })
    return () => { cancelled = true }
  }, [])

  if (error) return <Card><p style={{ margin: 0 }}>{error}</p></Card>
  if (!sessions) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><LoadingSpinner label="Loading history..." /></div>

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem' }}>Interview History</h1>

      {sessions.length === 0 ? (
        <EmptyState
          title="No interviews yet"
          description="Start your first mock interview to see it here."
          action={<Link to="/interview/setup" className="btn btn-primary">Start an interview</Link>}
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-500)' }}>
                {['Date', 'Type', 'Target Role', 'Difficulty', 'Final Score', 'Status', ''].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', fontSize: '0.78rem', color: 'var(--text-500)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const completed = s.status === 'completed'
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-500)' }}>
                    <td style={{ padding: '12px 16px' }}>{formatDate(s.started_at)}</td>
                    <td style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{s.interview_type}</td>
                    <td style={{ padding: '12px 16px' }}>{s.target_role || '—'}</td>
                    <td style={{ padding: '12px 16px' }}><span className={`badge badge-${s.difficulty}`}>{s.difficulty}</span></td>
                    <td className="mono" style={{ padding: '12px 16px' }}>{s.final_score ?? '—'}</td>
                    <td style={{ padding: '12px 16px', textTransform: 'capitalize', color: 'var(--text-500)' }}>{String(s.status).replace('_', ' ')}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <Link to={completed ? `/interview/${s.id}/results` : `/interview/${s.id}`} style={{ color: 'var(--accent-amber)' }}>
                        {completed ? 'View results' : 'Resume'}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
