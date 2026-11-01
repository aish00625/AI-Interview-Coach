import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { applicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { statusLabel } from '../utils/applicationLabels.js'

export default function MyApplications() {
  const [apps, setApps] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    applicationApi.list()
      .then((a) => !cancelled && setApps(a))
      .catch((err) => { if (!cancelled) { setError(apiErrorMessage(err, 'Could not load your applications.')); setApps([]) } })
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      <h1>My applications</h1>
      {error && <div className="field-error">{error}</div>}
      {apps === null ? <LoadingSpinner label="Loading..." /> : apps.length === 0 ? (
        <EmptyState title="No applications yet" description="Browse open jobs and apply with one of your resumes." action={<Link to="/jobs">Browse jobs</Link>} />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {apps.map((a) => (
            <Link key={a.id} to={`/applications/${a.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{a.job_title}</h3>
                    <div style={{ color: 'var(--text-500)' }}>{a.organization_name} · applied {new Date(a.created_at).toLocaleDateString()}</div>
                  </div>
                  <span className="badge">{statusLabel(a.status)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
