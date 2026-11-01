import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Select from '../components/Select.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerJobApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

const INTERVIEW_TYPES = [
  { value: 'technical', label: 'Technical' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'hr', label: 'HR' },
  { value: 'mixed', label: 'Mixed' },
]
const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]
const MAX_PROBLEMS = 5

/** Configure the interview and coding assessments candidates take after applying. Frozen once any candidate starts. */
export default function HirerJobAssessment() {
  const { id } = useParams()
  const [catalog, setCatalog] = useState([])
  const [form, setForm] = useState(null)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([hirerJobApi.getAssessment(id), hirerJobApi.codingProblems()])
      .then(([a, problems]) => {
        if (cancelled) return
        setCatalog(problems)
        setLocked(a.locked)
        setForm({
          interviewEnabled: a.interview_enabled, interviewType: a.interview_type, interviewDifficulty: a.interview_difficulty,
          problemIds: a.problems.map((p) => p.id),
        })
      })
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not load this job.')))
    return () => { cancelled = true }
  }, [id])

  function toggleProblem(pid) {
    setSaved(false)
    setForm((f) => {
      if (f.problemIds.includes(pid)) return { ...f, problemIds: f.problemIds.filter((x) => x !== pid) }
      if (f.problemIds.length >= MAX_PROBLEMS) return f
      return { ...f, problemIds: [...f.problemIds, pid] }
    })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      const a = await hirerJobApi.setAssessment(id, form)
      setLocked(a.locked)
      setSaved(true)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (error && !form) return <div><Link to="/hirer/jobs">← Job openings</Link><div className="field-error" style={{ marginTop: 12 }}>{error}</div></div>
  if (!form) return <LoadingSpinner label="Loading..." />

  return (
    <div>
      <Link to="/hirer/jobs">← Job openings</Link>
      <h1>Job assessment</h1>
      <p style={{ color: 'var(--text-500)' }}>
        Candidates take these after applying. Results are indicative signals to support your review, not automatic decisions.
      </p>
      {locked && <Card style={{ marginBottom: 16 }}><p style={{ margin: 0 }}>Candidates have already started these assessments, so they can no longer be changed.</p></Card>}
      <Card>
        <form onSubmit={save}>
          <fieldset disabled={locked || saving} style={{ border: 0, padding: 0, margin: 0 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <input type="checkbox" checked={form.interviewEnabled} onChange={(e) => { setSaved(false); setForm({ ...form, interviewEnabled: e.target.checked }) }} />
              Include an AI interview
            </label>
            {form.interviewEnabled && (
              <>
                <Select label="Interview type" name="interviewType" value={form.interviewType} onChange={(e) => setForm({ ...form, interviewType: e.target.value })} options={INTERVIEW_TYPES} />
                <Select label="Difficulty" name="interviewDifficulty" value={form.interviewDifficulty} onChange={(e) => setForm({ ...form, interviewDifficulty: e.target.value })} options={DIFFICULTIES} />
              </>
            )}
            <h3>Coding problems (up to {MAX_PROBLEMS})</h3>
            {catalog.length === 0 ? <p>No coding problems are available.</p> : (
              <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflow: 'auto', marginBottom: 12 }}>
                {catalog.map((p) => (
                  <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={form.problemIds.includes(p.id)} onChange={() => toggleProblem(p.id)} />
                    {p.title} <span className={`badge badge-${p.difficulty}`}>{p.difficulty}</span>{p.topic ? <span style={{ color: 'var(--text-500)' }}>{p.topic}</span> : null}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
          {saved && <div style={{ marginBottom: 12 }}>Saved.</div>}
          {!locked && <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save assessment'}</Button>}
        </form>
      </Card>
    </div>
  )
}
