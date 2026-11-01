import { useState } from 'react'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import { accountApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { saveBlob } from '../utils/download.js'
import { useAuth } from '../hooks/useAuth.js'

/** Download a copy of your data, or permanently delete your account. Both are checked on the server. */
export default function Account() {
  const { user, role, logout } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  async function exportData() {
    setBusy(true); setError(''); setInfo('')
    try {
      const data = await accountApi.exportData()
      saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'my-data-export.json')
      setInfo('Your data export was downloaded.')
    } catch (err) { setError(apiErrorMessage(err, 'Export failed.')) } finally { setBusy(false) }
  }
  async function remove(e) {
    e.preventDefault()
    setBusy(true); setError(''); setInfo('')
    try {
      await accountApi.deleteAccount(password)
      logout()
      window.location.assign('/')
    } catch (err) { setError(apiErrorMessage(err, 'Could not delete the account.')); setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Account</h1>
      <p style={{ color: 'var(--text-500)' }}>{user?.name} · {user?.email} · {role}</p>
      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
      {info && <div role="status" style={{ marginBottom: 12 }}>{info}</div>}

      <Card>
        <h3 style={{ marginTop: 0 }}>Download my data</h3>
        <p>A JSON copy of your profile, resumes (text and details), practice sessions, coding submissions, applications and notifications.
          {role === 'hirer' ? ' For hiring accounts: your organization membership, notes and scorecards you wrote.' : ' Resume files themselves can be downloaded from My Resumes.'}</p>
        <Button onClick={exportData} disabled={busy}>Download export</Button>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Delete my account</h3>
        {role === 'candidate' ? (
          <p>This permanently deletes your profile, practice history, coding submissions, resumes (including the stored files), and every job application with its assessment results and the hiring teams&apos; notes about it. It cannot be undone.</p>
        ) : (
          <p>This permanently deletes your account. Notes and scorecards you wrote stay with your organization with your name removed, and jobs you created stay with the organization. If you are the only owner of an organization that has other members or candidate applications, deletion is blocked until that is resolved.</p>
        )}
        {role === 'admin' ? <p style={{ color: 'var(--text-500)' }}>Administrator accounts cannot be deleted from the app.</p> : (
          <form onSubmit={remove}>
            <div className="field">
              <label htmlFor="delPassword">Your password</label>
              <input id="delPassword" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="delConfirm">Type DELETE to confirm</label>
              <input id="delConfirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" variant="danger" disabled={busy || !password || confirm !== 'DELETE'}>Delete my account permanently</Button>
          </form>
        )}
      </Card>
    </div>
  )
}
