import { useEffect, useState } from 'react'
import { resumeApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

/** Suggests skills found in one of the candidate's own resumes. Suggestions only: the candidate chooses what to add, then saves the profile. */
export default function ResumeSkillSuggestions({ currentSkills, onAdd }) {
  const [resumes, setResumes] = useState([])
  const [resumeId, setResumeId] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { resumeApi.list().then(setResumes).catch(() => setResumes([])) }, [])
  if (resumes.length === 0) return null

  async function find() {
    if (!resumeId) return
    setLoading(true); setError(''); setResult(null)
    try { setResult(await resumeApi.suggestSkills(resumeId)) } catch (err) { setError(apiErrorMessage(err, 'Could not read that resume.')) } finally { setLoading(false) }
  }

  const have = new Set(currentSkills.map((s) => s.toLowerCase()))
  const fresh = (result?.suggestions || []).filter((s) => !have.has(s.name.toLowerCase()))
  return (
    <div style={{ margin: '0 0 16px', padding: 12, border: '1px solid var(--border-500)', borderRadius: 8 }}>
      <div style={{ fontSize: '0.85rem', marginBottom: 6 }}>Find skills in a resume</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} aria-label="Resume to scan">
          <option value="">Choose a resume</option>
          {resumes.map((r) => <option key={r.id} value={r.id}>{r.original_filename}</option>)}
        </select>
        <button type="button" className="btn btn-secondary" onClick={find} disabled={!resumeId || loading}>{loading ? 'Reading...' : 'Suggest skills'}</button>
      </div>
      {error && <div className="field-error" style={{ marginTop: 8 }}>{error}</div>}
      {result && !result.available && <p style={{ margin: '8px 0 0', color: 'var(--text-500)', fontSize: '0.82rem' }}>{result.reason}</p>}
      {result?.available && (
        <div style={{ marginTop: 8 }}>
          {fresh.length === 0 ? <p style={{ margin: 0, fontSize: '0.85rem' }}>No new skills found. Everything recognised is already on your profile.</p> : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {fresh.map((s) => (
                  <button key={s.name} type="button" className="badge" onClick={() => onAdd(s.name)} title={`Found as "${s.matchedAs.join('", "')}" (${s.mentions}×). Click to add.`}>+ {s.name}</button>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', color: 'var(--text-500)', fontSize: '0.78rem' }}>{result.note} Click a skill to add it, then press Save Profile.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
