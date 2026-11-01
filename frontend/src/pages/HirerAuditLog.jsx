import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerTeamApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

/** Owners only. Every time a team member opens a candidate's resume or assessment results, an entry is written first. */
export default function HirerAuditLog() {
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    hirerTeamApi.auditLog({ limit: 50 })
      .then((e) => { if (!cancelled) { setEntries(e); setMore(e.length === 50) } })
      .catch((err) => { if (!cancelled) { setError(apiErrorMessage(err, 'Could not load the access log.')); setEntries([]) } })
    return () => { cancelled = true }
  }, [])

  async function loadMore() {
    try {
      const next = await hirerTeamApi.auditLog({ limit: 50, before: entries[entries.length - 1].id })
      setEntries((cur) => [...cur, ...next]); setMore(next.length === 50)
    } catch (err) { setError(apiErrorMessage(err)) }
  }

  return (
    <div>
      <h1>Access log</h1>
      <p style={{ color: 'var(--text-500)' }}>Who opened candidate resumes and assessment results. Candidates can see that their data was accessed (the organization and the kind of access, not the person).</p>
      {error && <div className="field-error">{error}</div>}
      {entries === null ? <LoadingSpinner label="Loading..." /> : entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Entries appear when a team member opens a resume or assessment results." />
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left' }}><th>When</th><th>Team member</th><th>Action</th><th>Application</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border-400)' }}>
                  <td>{new Date(e.created_at).toLocaleString()}</td>
                  <td>{e.actor_name || 'Removed account'}</td>
                  <td>{e.action.replace('_', ' ')}</td>
                  <td>{e.application_id ? <Link to={`/hirer/applications/${e.application_id}`}>#{e.application_id}{e.job_title ? ` — ${e.job_title}` : ''}</Link> : <em>deleted</em>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && <Button variant="secondary" onClick={loadMore} style={{ marginTop: 12 }}>Load older entries</Button>}
        </Card>
      )}
    </div>
  )
}
