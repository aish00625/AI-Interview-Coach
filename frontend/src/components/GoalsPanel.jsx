import { useState } from 'react'
import Panel from './Panel.jsx'
import Button from './Button.jsx'
import { dashboardApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

function GoalRow({ label, done, target }) {
  const pct = target > 0 ? Math.min(100, Math.round((100 * done) / target)) : 0
  return (
    <div>
      <div className="row-between small"><span>{label}</span><span className="mono">{done} / {target}</span></div>
      <div className="meter green" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(done, target)}><span style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

/**
 * Weekly goals the candidate chooses (nothing is pre-filled for them). Saves through PUT /dashboard/goals, then asks the
 * parent to reload so the progress shown is what the server counted from real records. Weeks run Monday-Sunday (UTC).
 */
export default function GoalsPanel({ goals, onSaved }) {
  const current = goals.current
  const [editing, setEditing] = useState(!current)
  const [interviews, setInterviews] = useState(current ? String(current.weeklyInterviews) : '2')
  const [problems, setProblems] = useState(current ? String(current.weeklyProblems) : '5')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const whole = (v, max) => /^\d+$/.test(v) && Number(v) <= max
  async function save(e) {
    e.preventDefault()
    setError(''); setSaved(false)
    if (!whole(interviews, 50)) return setError('Interviews per week must be a whole number from 0 to 50.')
    if (!whole(problems, 200)) return setError('Problems per week must be a whole number from 0 to 200.')
    setSaving(true)
    try {
      await dashboardApi.setGoals({ weeklyInterviews: Number(interviews), weeklyProblems: Number(problems) })
      setSaved(true); setEditing(false)
      if (onSaved) await onSaved()
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save your goals. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel title="Weekly goals" aside={current && !editing ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button> : null}>
      {current && !editing && (
        <div className="stack" style={{ gap: 12 }}>
          {current.weeklyInterviews > 0 && <GoalRow label="Practice interviews completed" done={goals.progress.interviews} target={current.weeklyInterviews} />}
          {current.weeklyProblems > 0 && <GoalRow label="Coding problems solved" done={goals.progress.problems} target={current.weeklyProblems} />}
          {current.weeklyInterviews === 0 && current.weeklyProblems === 0 && <p className="muted" style={{ margin: 0 }}>Both goals are set to 0 (off). Edit them to track progress.</p>}
          <p className="small muted" style={{ margin: 0 }}>Counted from your practice this week (Monday–Sunday, UTC). Distinct problems only; a problem counts once.</p>
        </div>
      )}
      {editing && (
        <form onSubmit={save} className="stack" style={{ gap: 12 }} noValidate>
          {!current && <p className="muted" style={{ margin: 0 }}>Pick weekly targets you can realistically hit. They are only used to show your own progress.</p>}
          <div className="row">
            <label className="field" style={{ margin: 0 }}>
              <span className="small muted" style={{ display: 'block', marginBottom: 4 }}>Interviews / week</span>
              <input className="input input-inline" inputMode="numeric" value={interviews} onChange={(e) => setInterviews(e.target.value)} aria-label="Practice interviews per week" />
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span className="small muted" style={{ display: 'block', marginBottom: 4 }}>Problems / week</span>
              <input className="input input-inline" inputMode="numeric" value={problems} onChange={(e) => setProblems(e.target.value)} aria-label="Coding problems per week" />
            </label>
          </div>
          {error && <div className="field-error" role="alert">{error}</div>}
          <div className="row">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save goals'}</Button>
            {current && <Button type="button" variant="secondary" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>}
          </div>
        </form>
      )}
      {saved && !editing && <div className="small" style={{ color: 'var(--success)', marginTop: 8 }} role="status">Goals saved.</div>}
    </Panel>
  )
}
