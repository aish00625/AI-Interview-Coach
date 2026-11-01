import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerJobApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { employmentLabel } from '../utils/jobLabels.js'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

export default function HirerJobs() {
  const confirm = useConfirm()
  const toast = useToast()
  const [jobs, setJobs] = useState(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      setJobs(await hirerJobApi.list(filter ? { status: filter } : undefined))
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load your jobs.'))
      setJobs([])
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function changeStatus(job, status) {
    setBusyId(job.id)
    setError('')
    try {
      await hirerJobApi.setStatus(job.id, status)
      await load()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(job) {
    if (!(await confirm({ title: 'Delete this draft job?', message: `"${job.title}" will be permanently deleted. This cannot be undone.`, confirmLabel: 'Delete draft', tone: 'danger' }))) return
    setBusyId(job.id)
    setError('')
    try {
      await hirerJobApi.remove(job.id)
      await load()
      toast.success('Draft deleted.')
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1>Job openings</h1>
        <Link to="/hirer/jobs/new"><Button>New job</Button></Link>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className="badge"
            onClick={() => setFilter(f.value)}
            style={{ cursor: 'pointer', background: 'none', borderColor: filter === f.value ? 'var(--accent-amber)' : 'var(--border-400)', color: filter === f.value ? 'var(--accent-amber)' : 'var(--text-300)' }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
      {jobs === null ? (
        <LoadingSpinner label="Loading jobs..." />
      ) : jobs.length === 0 ? (
        <EmptyState title="No jobs yet" description="Create a job opening, add its required skills, then publish it for candidates." action={<Link to="/hirer/jobs/new"><Button>Create your first job</Button></Link>} />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {jobs.map((job) => (
            <Card key={job.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{job.title}</h3>
                  <div style={{ color: 'var(--text-500)', margin: '4px 0 8px' }}>
                    {employmentLabel(job.employment_type)}{job.location ? ` · ${job.location}` : ''}
                    {job.closes_at ? ` · closes ${new Date(job.closes_at).toLocaleDateString()}` : ''}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <span className="badge">{job.status}</span>
                    {job.required_skills.map((s) => <span key={s.id} className="badge">{s.name}{s.mandatory ? '' : ' (optional)'}</span>)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {job.status !== 'draft' && <Link to={`/hirer/jobs/${job.id}/applicants`}><Button variant="secondary">Applicants</Button></Link>}
                  <Link to={`/hirer/jobs/${job.id}/edit`}><Button variant="secondary">Edit</Button></Link>
                  <Link to={`/hirer/jobs/${job.id}/assessment`}><Button variant="secondary">Assessment</Button></Link>
                  {job.status !== 'open' && <Button disabled={busyId === job.id} onClick={() => changeStatus(job, 'open')}>{job.status === 'closed' ? 'Reopen' : 'Publish'}</Button>}
                  {job.status === 'open' && <Button variant="secondary" disabled={busyId === job.id} onClick={() => changeStatus(job, 'closed')}>Close</Button>}
                  {job.status === 'draft' && <Button variant="danger" disabled={busyId === job.id} onClick={() => remove(job)}>Delete</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
