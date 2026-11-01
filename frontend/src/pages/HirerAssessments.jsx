import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Badge from '../components/Badge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerAssessmentApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { useAuth } from '../hooks/useAuth.js'

const STATUS_TONE = { draft: 'muted', published: 'success', closed: 'neutral' }

/** Assessment dashboard: every assessment the caller may see (reviewers: only the ones assigned to them). */
export default function HirerAssessments() {
  const { user } = useAuth()
  const canBuild = ['owner', 'recruiter'].includes(user?.organization?.memberRole)
  const [list, setList] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    hirerAssessmentApi.list().then(setList).catch((e) => setError(apiErrorMessage(e, 'Could not load assessments.')))
  }, [])

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Aptitude, technical MCQ and coding assessments for your jobs. Results support your decisions; they never make them."
        actions={canBuild && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-secondary" to="/hirer/question-bank">Question bank</Link>
            <Link className="btn btn-primary" to="/hirer/assessments/new">New assessment</Link>
          </div>
        )}
      />
      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
      {!list && !error && <LoadingSpinner label="Loading assessments..." />}
      {list && list.length === 0 && (
        <EmptyState
          title="No assessments yet"
          description={canBuild ? 'Create one for a job, add questions from your question bank and coding problems, then publish and invite applicants.' : 'Assessments assigned to you for review will appear here.'}
          action={canBuild && <Link className="btn btn-primary" to="/hirer/assessments/new">New assessment</Link>}
        />
      )}
      {list && list.length > 0 && (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}><th>Assessment</th><th>Job</th><th>Status</th><th>Invited</th><th>Started</th><th>Finished</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border-400)' }}>
                    <td style={{ padding: '8px 4px' }}><Link to={`/hirer/assessments/${a.id}`}>{a.title}</Link> <span className="small muted">v{a.version}</span></td>
                    <td>{a.jobTitle}</td>
                    <td><Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge></td>
                    <td>{a.counts.invited}</td>
                    <td>{a.counts.started}</td>
                    <td>{a.counts.submitted}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><Link to={`/hirer/assessments/${a.id}/candidates`}>Candidates &amp; results</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
