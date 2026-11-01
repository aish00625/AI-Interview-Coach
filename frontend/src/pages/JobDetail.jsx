import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ApplyPanel from '../components/ApplyPanel.jsx'
import Card from '../components/Card.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import JobFitPanel from '../components/JobFitPanel.jsx'
import { jobApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { employmentLabel, experienceLabel } from '../utils/jobLabels.js'

export default function JobDetail() {
  const { id } = useParams()
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(null)

  useEffect(() => {
    let cancelled = false
    jobApi.get(id)
      .then((j) => !cancelled && setJob(j))
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'This job is not available.')))
    return () => { cancelled = true }
  }, [id])

  if (error) return <div><Link to="/jobs">← All jobs</Link><div className="field-error" style={{ marginTop: 12 }}>{error}</div></div>
  if (!job) return <LoadingSpinner label="Loading job..." />

  return (
    <div>
      <Link to="/jobs">← All jobs</Link>
      <h1>{job.title}</h1>
      <div style={{ color: 'var(--text-500)', marginBottom: 12 }}>
        {job.organization_name} · {employmentLabel(job.employment_type)}{job.location ? ` · ${job.location}` : ''} · {experienceLabel(job.experience_level)}
        {job.closes_at ? ` · apply by ${new Date(job.closes_at).toLocaleDateString()}` : ''}
      </div>
      <Card>
        <h3 style={{ marginTop: 0 }}>About the role</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{job.description}</p>
        {job.eligibility_criteria && (<><h3>Eligibility</h3><p style={{ whiteSpace: 'pre-wrap' }}>{job.eligibility_criteria}</p></>)}
        <h3>Required skills</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {job.required_skills.map((s) => <span key={s.id} className="badge">{s.name}{s.mandatory ? '' : ' (optional)'}</span>)}
        </div>
      </Card>
      <JobFitPanel jobId={id} />
      {applied ? (
        <Card style={{ marginTop: 16 }}>
          <p>Application submitted. <Link to={`/applications/${applied.id}`}>View your application →</Link></p>
        </Card>
      ) : (
        <ApplyPanel jobId={id} onApplied={setApplied} />
      )}
    </div>
  )
}
