import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerApplicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { statusLabel, APPLICATION_STATUS_LABELS } from '../utils/applicationLabels.js'
import AdvisoryNote from '../components/AdvisoryNote.jsx'

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'match', label: 'Best skill match' },
  { value: 'interview', label: 'Highest AI interview score (advisory)' },
]

export default function HirerApplicants() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('newest')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])

  const load = useCallback(async () => {
    setError('')
    try {
      const params = { sort }
      if (status) params.status = status
      if (search.trim()) params.search = search.trim()
      setData(await hirerApplicationApi.listForJob(id, params))
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load applicants.'))
      setData({ job: null, applicants: [] })
    }
  }, [id, status, sort, search])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  function toggle(appId) {
    setSelected((cur) => (cur.includes(appId) ? cur.filter((x) => x !== appId) : cur.length >= 5 ? cur : [...cur, appId]))
  }

  return (
    <div>
      <Link to="/hirer/jobs">← Job openings</Link>
      <h1>Applicants{data?.job ? ` — ${data.job.title}` : ''}</h1>
      <AdvisoryNote />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search name or email (not available for anonymous applicants)" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
        <select className="select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option>
          {Object.entries(APPLICATION_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 220 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Button variant="secondary" disabled={selected.length < 2} onClick={() => navigate(`/hirer/jobs/${id}/compare?ids=${selected.join(',')}`)}>
          Compare selected ({selected.length}/5)
        </Button>
      </div>
      <p style={{ color: 'var(--text-500)', fontSize: 13 }}>
        Skill match and assessment scores are indicative signals to help your review; they do not decide anything automatically.
      </p>
      {error && <div className="field-error">{error}</div>}
      {data === null ? <LoadingSpinner label="Loading applicants..." /> : data.applicants.length === 0 ? (
        <EmptyState title="No applicants found" description="Candidates appear here after they apply to this job." />
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th></th><th>Candidate</th><th>Status</th><th>Skill match</th><th>Interview</th><th>Coding</th><th>Applied</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.applicants.map((a) => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border-400)' }}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${a.candidate_name}`} disabled={a.status === 'withdrawn' || (!selected.includes(a.id) && selected.length >= 5)}
                      checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
                  </td>
                  <td>{a.status === 'withdrawn' ? <em>Withdrawn</em> : <>{a.candidate_name}<div style={{ color: 'var(--text-500)', fontSize: 12 }}>{a.experience_level}{a.identity_hidden ? ' · identity hidden (blind review)' : ''}{a.scorecard_count ? ` · ${a.scorecard_count} scorecard${a.scorecard_count > 1 ? 's' : ''}` : ''}</div></>}</td>
                  <td><span className="badge">{statusLabel(a.status)}</span></td>
                  <td>{a.skill_match_percent == null ? '—' : `${a.skill_match_percent}% (${a.skills_matched}/${a.skills_required})`}</td>
                  <td>{!a.consent_assessment ? <span title="The candidate has not agreed to share assessment results">not shared</span> : a.interview_score != null ? `${a.interview_score}/100` : a.interview_status === 'in_progress' ? 'In progress' : '—'}</td>
                  <td>{!a.consent_assessment ? <span title="The candidate has not agreed to share assessment results">not shared</span> : a.coding_problems_assigned ? `${a.coding_problems_passed}/${a.coding_problems_assigned} solved` : '—'}</td>
                  <td>{new Date(a.created_at).toLocaleDateString()}</td>
                  <td><Link to={`/hirer/applications/${a.id}`}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
