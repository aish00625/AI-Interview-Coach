import { useEffect, useState, useCallback } from 'react'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { adminApi } from '../services/api.js'

const FILTERS = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['', 'All']]

/** Admin-only: review hiring organizations. The backend re-checks role=admin on every call. */
export default function AdminOrganizations() {
  const [status, setStatus] = useState('pending')
  const [orgs, setOrgs] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      setOrgs(await adminApi.listOrganizations(status || undefined))
    } catch (err) {
      setOrgs([])
      setError(err?.response?.status === 403 ? 'You do not have permission to view this page.' : 'Could not load organizations.')
    }
  }, [status])

  useEffect(() => {
    setOrgs(null)
    load()
  }, [load])

  async function act(id, action) {
    setBusyId(id)
    setError('')
    try {
      await adminApi[action](id)
      await load()
    } catch {
      setError('Could not update the organization. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h1>Hiring organizations</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(([value, label]) => (
          <button key={label} type="button" className={status === value ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setStatus(value)}>
            {label}
          </button>
        ))}
      </div>
      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
      {orgs === null ? (
        <LoadingSpinner label="Loading organizations..." />
      ) : orgs.length === 0 ? (
        <EmptyState title="No organizations" description="Nothing matches this filter." />
      ) : (
        orgs.map((org) => (
          <Card key={org.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{org.name} <span className="badge">{org.status}</span></div>
                <div style={{ color: 'var(--text-500)', fontSize: '0.85rem', marginTop: 4 }}>
                  {org.owner_name} · {org.owner_email} · registered {new Date(org.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {org.status !== 'approved' && (
                  <Button disabled={busyId === org.id} onClick={() => act(org.id, 'approveOrganization')}>Approve</Button>
                )}
                {org.status === 'pending' && (
                  <Button variant="secondary" disabled={busyId === org.id} onClick={() => act(org.id, 'rejectOrganization')}>Reject</Button>
                )}
                {org.status === 'approved' && (
                  <Button variant="secondary" disabled={busyId === org.id} onClick={() => act(org.id, 'suspendOrganization')}>Suspend</Button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
