import { useState } from 'react'
import Modal from './Modal.jsx'
import Button from './Button.jsx'

/** Asks for the required structured reason before an application is rejected. The candidate sees the neutral reason text, never the private note. */
export default function RejectDialog({ open, reasons, busy, onCancel, onConfirm }) {
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const reason = code ? reasons[code] : null
  const needsNote = Boolean(reason?.requiresNote)
  const valid = Boolean(code) && (!needsNote || note.trim().length >= 10)
  return (
    <Modal open={open} onClose={onCancel} title="Reject this application">
      <p style={{ marginTop: 0 }}>A reason is required. The candidate will be told the reason shown below, in plain words.</p>
      <div className="field">
        <label htmlFor="rejectReason">Reason</label>
        <select id="rejectReason" className="select" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose a reason...</option>
          {Object.entries(reasons).map(([c, r]) => <option key={c} value={c}>{r.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rejectNote">{needsNote ? 'Explanation (required, at least 10 characters)' : 'Private note for your team (optional)'}</label>
        <textarea id="rejectNote" className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p style={{ color: 'var(--text-500)', fontSize: 13 }}>The note stays inside your organization. Automated scores are advisory and must not be the only basis for a rejection.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" disabled={!valid || busy} onClick={() => onConfirm(code, note.trim())}>Reject application</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </Modal>
  )
}
