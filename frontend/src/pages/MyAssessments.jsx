import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Badge from '../components/Badge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { candidateAssessmentApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

/** Assessments hiring teams invited me to. Starting, timing and scoring are all decided by the server. */
export default function MyAssessments() {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { candidateAssessmentApi.list().then(setList).catch((e) => setError(apiErrorMessage(e, 'Could not load your assessments.'))) }, [])

  return (
    <div>
      <PageHeader title="My assessments" description="Assessments from hiring teams you applied to. Your answers are shared only with that team." />
      {error && <div className="field-error">{error}</div>}
      {!list && !error && <LoadingSpinner label="Loading assessments..." />}
      {list && !list.length && <EmptyState title="No assessments yet" description="When a hiring team invites you to an assessment it appears here, and you get a notification." />}
      {list && list.map((inv) => (
        <Card key={inv.invitationId} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: '0 0 4px' }}>{inv.assessment.title}</h3>
              <div className="small muted">{inv.organizationName} - {inv.jobTitle} - {inv.assessment.durationMinutes} minutes - attempts {inv.attemptsUsed}/{inv.assessment.maxAttempts}</div>
              {inv.assessment.availableUntil && <div className="small muted">Open until {new Date(inv.assessment.availableUntil).toLocaleString()}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {inv.latestStatus && <Badge tone={inv.latestStatus === 'in_progress' ? 'info' : 'success'}>{inv.latestStatus === 'in_progress' ? 'in progress' : inv.latestStatus}</Badge>}
              {inv.openAttemptId
                ? <Link className="btn btn-primary" to={`/assessments/${inv.invitationId}`}>Resume</Link>
                : inv.canStart
                  ? <Link className="btn btn-primary" to={`/assessments/${inv.invitationId}`}>Open</Link>
                  : inv.latestAttemptId
                    ? <Link className="btn btn-secondary" to={`/assessments/${inv.invitationId}`}>View confirmation</Link>
                    : null}
            </div>
          </div>
          {!inv.canStart && !inv.openAttemptId && inv.blockedMessage && <p className="small" style={{ marginBottom: 0 }}>{inv.blockedMessage}</p>}
        </Card>
      ))}
    </div>
  )
}
