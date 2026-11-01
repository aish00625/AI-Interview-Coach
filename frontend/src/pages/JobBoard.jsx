import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { jobApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { employmentLabel } from '../utils/jobLabels.js'

export default function JobBoard() {
  const [jobs, setJobs] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      jobApi.list(search.trim() ? { search: search.trim() } : undefined)
        .then((j) => { if (!cancelled) { setJobs(j); setError('') } })
        .catch((err) => { if (!cancelled) { setError(apiErrorMessage(err, 'Could not load jobs.')); setJobs([]) } })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  return (
    <div>
      <h1>Job openings</h1>
      <input className="input" placeholder="Search by job title or company" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} style={{ margin: '8px 0 16px' }} />
      {error && <div className="field-error">{error}</div>}
      {jobs === null ? <LoadingSpinner label="Loading jobs..." /> : jobs.length === 0 ? (
        <EmptyState title="No open jobs found" description="Check back later, or try a different search." />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {jobs.map((job) => (
            <Link key={job.id} to={`/jobs/${job.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <Card>
                <h3 style={{ margin: 0 }}>{job.title}</h3>
                <div style={{ color: 'var(--text-500)', margin: '4px 0 8px' }}>
                  {job.organization_name} · {employmentLabel(job.employment_type)}{job.location ? ` · ${job.location}` : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {job.required_skills.map((s) => <span key={s.id} className="badge">{s.name}</span>)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
