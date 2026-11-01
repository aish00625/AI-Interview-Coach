import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import PageHeader from '../components/PageHeader.jsx'
import Panel from '../components/Panel.jsx'
import StatCard from '../components/StatCard.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import { DashboardSkeleton } from '../components/Skeleton.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { hirerApplicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { statusLabel } from '../utils/applicationLabels.js'
import { CHART, axisProps } from '../utils/chartTheme.js'

const STATUS_TEXT = {
  pending: 'Your organization is awaiting approval by an administrator. You will be able to create job openings and review candidates once it is approved.',
  approved: 'Your organization is approved.',
  rejected: 'Your organization was not approved. Please contact the platform administrator.',
  suspended: 'Your organization has been suspended. Please contact the platform administrator.',
}
const ORG_TONE = { pending: 'warning', approved: 'success', rejected: 'danger', suspended: 'danger' }
const JOB_TONE = { open: 'success', draft: 'muted', closed: 'warning' }

// Stages of the review pipeline in order. "Rejected" is shown separately because it is an outcome, not a stage.
const STAGES = [
  { key: 'submitted', label: 'Awaiting review' },
  { key: 'under_review', label: 'In review' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'hired', label: 'Hired' },
]

function Funnel({ byStatus }) {
  const count = (k) => byStatus[k] || 0
  const total = STAGES.reduce((s, st) => s + count(st.key), 0) + count('rejected')
  if (total === 0) return <p className="muted" style={{ margin: 0 }}>No applications yet. Publish a job and applications will appear here.</p>
  return (
    <div>
      {[...STAGES, { key: 'rejected', label: 'Rejected' }].map((st) => (
        <div key={st.key} className="funnel-row">
          <span>{st.label}</span>
          <div className={`meter ${st.key === 'hired' ? 'green' : st.key === 'rejected' ? 'amber' : ''}`} aria-hidden="true"><span style={{ width: `${(100 * count(st.key)) / total}%` }} /></div>
          <span className="mono" style={{ textAlign: 'right' }}>{count(st.key)}</span>
        </div>
      ))}
      <p className="small muted" style={{ marginBottom: 0 }}>Withdrawn applications are not counted. Status changes are made by people; nothing here is decided automatically.</p>
    </div>
  )
}

/** Hiring dashboard. Approval state comes from GET /auth/me; metrics come from GET /hirer/dashboard (approved orgs only, scoped to your organization on the server). */
export default function HirerDashboard() {
  const { user, refreshUser } = useAuth()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)

  // Re-read from the database on arrival so a fresh approval shows up without logging out.
  useEffect(() => {
    refreshUser().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const approved = user?.organization?.status === 'approved'
  useEffect(() => {
    if (!approved) return undefined
    let cancelled = false
    hirerApplicationApi.dashboard()
      .then((d) => !cancelled && setStats(d))
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not load dashboard figures.')))
    return () => { cancelled = true }
  }, [approved])

  async function recheck() {
    setChecking(true)
    setError('')
    try {
      await refreshUser()
    } catch {
      setError('Could not refresh your status. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  if (!user) return <DashboardSkeleton label="Loading" />
  const org = user.organization
  const pipeline = stats?.applicationsByStatus || {}
  const totalApplications = stats ? Object.entries(pipeline).filter(([k]) => k !== 'withdrawn').reduce((s, [, n]) => s + n, 0) : 0
  const totalJobs = stats ? Object.values(stats.jobsByStatus).reduce((s, n) => s + n, 0) : 0

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHeader
        title="Hiring dashboard"
        description={org ? `${org.name} · applications, pipeline and job performance for your organization only.` : undefined}
        actions={approved ? (
          <>
            <Link to="/hirer/jobs/new" className="btn btn-primary">Create a job</Link>
            <Link to="/hirer/jobs" className="btn btn-secondary">Manage jobs</Link>
          </>
        ) : null}
      />

      {!org ? (
        <Panel><p style={{ margin: 0 }}>No organization is linked to this account. Please contact the platform administrator.</p></Panel>
      ) : (
        <Panel hero={!approved} title="Organization">
          <div className="row" style={{ marginBottom: 8 }}>
            <strong>{org.name}</strong>
            <Badge tone={ORG_TONE[org.status] || 'neutral'}>{org.status}</Badge>
          </div>
          <p className="muted" style={{ margin: 0 }}>{STATUS_TEXT[org.status]}</p>
          {org.status === 'pending' && <Button style={{ marginTop: 12 }} onClick={recheck} disabled={checking}>{checking ? 'Checking...' : 'Check approval status'}</Button>}
        </Panel>
      )}
      {error && <div className="field-error" role="alert">{error}</div>}

      {approved && !stats && !error && <DashboardSkeleton label="Loading figures" />}
      {approved && stats && (
        <>
          <div className="grid grid-4">
            <StatCard label="Open jobs" value={stats.jobsByStatus.open || 0} to="/hirer/jobs" accent="indigo" hint={`${totalJobs} job${totalJobs === 1 ? '' : 's'} in total`} />
            <StatCard label="Applications" value={totalApplications} accent="amber" hint="Excluding withdrawn" />
            <StatCard label="Awaiting review" value={pipeline.submitted || 0} accent="violet" hint={pipeline.submitted ? 'Open a job to review them' : 'Nothing waiting'} />
            <StatCard
              label="Average time to first review"
              value={stats.firstReview.averageDays}
              unit=" days"
              accent="teal"
              hint={stats.firstReview.reviewedApplications ? `across ${stats.firstReview.reviewedApplications} reviewed application${stats.firstReview.reviewedApplications === 1 ? '' : 's'}` : 'No application has been reviewed yet'}
            />
          </div>

          <div className="grid grid-2">
            <Panel title="Hiring pipeline"><Funnel byStatus={pipeline} /></Panel>
            <Panel title="Applications per week" aside={<span className="small muted">last 8 weeks</span>}>
              {stats.applicationsByWeek.every((w) => w.n === 0) ? (
                <p className="muted" style={{ margin: 0 }}>No applications received in the last 8 weeks.</p>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={stats.applicationsByWeek.map((w) => ({ week: w.week.slice(5), applications: w.n }))} margin={{ left: -18, right: 4 }}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" {...axisProps} />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip content={<ChartTooltip labelFormatter={(l) => `Week of ${l}`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="applications" name="Applications" fill={CHART.primary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <Panel title="Job performance">
            {stats.jobs.length === 0 ? <p style={{ margin: 0 }}>No jobs yet. <Link to="/hirer/jobs/new">Create your first job</Link>.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Job</th><th>Status</th><th>Applicants</th><th>Awaiting</th><th>In review</th><th>Shortlisted</th><th>Hired</th><th></th></tr></thead>
                  <tbody>
                    {stats.jobs.map((j) => (
                      <tr key={j.id}>
                        <td>{j.title}</td>
                        <td><Badge tone={JOB_TONE[j.status] || 'neutral'}>{j.status}</Badge></td>
                        <td>{j.applicants}</td><td>{j.awaiting_review}</td><td>{j.under_review}</td><td>{j.shortlisted}</td><td>{j.hired}</td>
                        <td>{j.status !== 'draft' && <Link to={`/hirer/jobs/${j.id}/applicants`}>Applicants</Link>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Recent applications">
            {stats.recentApplications.length === 0 ? <p className="muted" style={{ margin: 0 }}>No applications yet.</p> : (
              <div>
                {stats.recentApplications.map((a) => (
                  <div key={a.id} className="list-row">
                    <div style={{ minWidth: 0 }}>
                      <Link to={`/hirer/applications/${a.id}`} style={{ fontWeight: 600 }}>{a.candidate_name}</Link>
                      <div className="small muted">{a.job_title} · {new Date(a.created_at).toLocaleDateString()}</div>
                    </div>
                    <Badge tone="info">{statusLabel(a.status)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
