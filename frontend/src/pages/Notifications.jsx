import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { notificationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

export default function Notifications() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setData(await notificationApi.list({ limit: 50 })) } catch (err) { setError(apiErrorMessage(err, 'Could not load notifications.')); setData({ notifications: [], unreadCount: 0 }) }
  }, [])
  useEffect(() => { load() }, [load])

  async function open(n) {
    if (n.read_at) return
    try { await notificationApi.markRead(n.id); await load(); window.dispatchEvent(new Event('notifications-changed')) } catch { /* the link still works */ }
  }
  async function readAll() {
    try { await notificationApi.markAllRead(); await load(); window.dispatchEvent(new Event('notifications-changed')) } catch (err) { setError(apiErrorMessage(err)) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Notifications</h1>
        {data?.unreadCount > 0 && <Button variant="secondary" onClick={readAll}>Mark all as read</Button>}
      </div>
      {error && <div className="field-error" style={{ marginTop: 12 }}>{error}</div>}
      {data === null ? <LoadingSpinner label="Loading..." /> : data.notifications.length === 0 ? (
        <EmptyState title="No notifications yet" description="You will be told here when the status of one of your applications changes." />
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          {data.notifications.map((n) => (
            <Card key={n.id} style={{ borderColor: n.read_at ? undefined : 'var(--accent-amber)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong>{n.title}</strong>
                  {n.body && <div style={{ color: 'var(--text-500)' }}>{n.body}</div>}
                  <div style={{ color: 'var(--text-500)', fontSize: 12 }}>{new Date(n.created_at).toLocaleString()}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {n.application_id && <Link to={`/applications/${n.application_id}`} onClick={() => open(n)}>View application</Link>}
                  {!n.read_at && <Button variant="secondary" onClick={() => open(n)}>Mark read</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
