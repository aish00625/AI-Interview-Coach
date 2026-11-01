import { useCallback, useEffect, useState } from 'react'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerTeamApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'

const ROLE_HELP = {
  owner: 'Everything, including the team and the access log.',
  recruiter: 'Manage jobs, change application statuses, review, write scorecards.',
  reviewer: 'Read applications, add notes and scorecards. Cannot change statuses or jobs.',
}

export default function HirerTeam() {
  const confirm = useConfirm()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('reviewer')
  const [created, setCreated] = useState(null)

  const load = useCallback(async () => {
    try { setData(await hirerTeamApi.get()) } catch (err) { setError(apiErrorMessage(err, 'Could not load your team.')) }
  }, [])
  useEffect(() => { load() }, [load])

  const isOwner = data?.you?.memberRole === 'owner'
  async function act(fn) {
    setBusy(true); setError('')
    try { await fn(); await load() } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }
  async function invite(e) {
    e.preventDefault()
    setBusy(true); setError(''); setCreated(null)
    try {
      const res = await hirerTeamApi.invite(email.trim(), role)
      setCreated({ ...res, link: `${window.location.origin}/register?invite=${res.inviteToken}` })
      setEmail(''); await load()
    } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  if (!data) return error ? <div className="field-error">{error}</div> : <LoadingSpinner label="Loading team..." />
  return (
    <div>
      <h1>Hiring team</h1>
      <p style={{ color: 'var(--text-500)' }}>Your role: <span className="badge">{data.you.memberRole}</span> — {ROLE_HELP[data.you.memberRole]}</p>
      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}

      <Card>
        <h3 style={{ marginTop: 0 }}>Members</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left' }}><th>Name</th><th>E-mail</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {data.members.map((m) => {
              const self = String(m.user_id) === String(data.you.userId)
              return (
                <tr key={m.user_id} style={{ borderTop: '1px solid var(--border-400)' }}>
                  <td>{m.name}{self ? ' (you)' : ''}</td>
                  <td>{m.email}</td>
                  <td>
                    {isOwner && !self ? (
                      <select className="select" aria-label={`Role of ${m.name}`} value={m.member_role} disabled={busy}
                        onChange={(e) => act(() => hirerTeamApi.setRole(m.user_id, e.target.value))}>
                        <option value="owner">owner</option><option value="recruiter">recruiter</option><option value="reviewer">reviewer</option>
                      </select>
                    ) : <span className="badge">{m.member_role}</span>}
                  </td>
                  <td>{isOwner && !self && m.member_role !== 'owner' && (
                    <Button variant="danger" disabled={busy} onClick={async () => { if (await confirm({ title: 'Remove team member?', message: `${m.name} will lose access to this organization's jobs and applicants.`, confirmLabel: 'Remove member', tone: 'danger' })) act(() => hirerTeamApi.removeMember(m.user_id)) }}>Remove</Button>
                  )}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {isOwner && (
        <Card style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Invite a colleague</h3>
          <form onSubmit={invite} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="inviteEmail">E-mail address</label>
              <input id="inviteEmail" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="inviteRole">Role</label>
              <select id="inviteRole" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="reviewer">reviewer</option><option value="recruiter">recruiter</option>
              </select>
            </div>
            <Button type="submit" disabled={busy || !email.trim()}>Create invitation</Button>
          </form>
          <p style={{ color: 'var(--text-500)', fontSize: 13 }}>{ROLE_HELP[role]} This app does not send e-mail: copy the link below and send it to your colleague yourself. It works once, only for that address, and expires after {created?.expiresInDays || 7} days.</p>
          {created && (
            <div role="status" style={{ border: '1px solid var(--accent-amber)', borderRadius: 6, padding: 12 }}>
              <strong>Invitation link for {created.invitation.email}</strong> (shown only now):
              <input className="input" readOnly value={created.link} onFocus={(e) => e.target.select()} style={{ marginTop: 6 }} />
            </div>
          )}
          {data.invitations.length > 0 && (
            <>
              <h4>Pending invitations</h4>
              <ul>
                {data.invitations.map((i) => (
                  <li key={i.id}>
                    {i.email} — {i.member_role}, expires {new Date(i.expires_at).toLocaleDateString()}{' '}
                    <Button variant="secondary" disabled={busy} onClick={() => act(() => hirerTeamApi.revokeInvitation(i.id))}>Revoke</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
