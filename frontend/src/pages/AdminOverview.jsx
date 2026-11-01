import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import PageHeader from '../components/PageHeader.jsx'
import Panel from '../components/Panel.jsx'
import StatCard from '../components/StatCard.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import { DashboardSkeleton } from '../components/Skeleton.jsx'
import { adminApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { CHART, axisProps } from '../utils/chartTheme.js'

const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + b, 0)
const ACTION_TEXT = { resume_view: 'Resume viewed', resume_download: 'Resume downloaded', assessment_view: 'Assessment viewed', comparison_view: 'Comparison viewed' }

function Breakdown({ title, counts, order }) {
  const keys = order || Object.keys(counts || {})
  return (
    <Panel title={title}>
      {keys.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing recorded yet.</p> : keys.map((k) => (
        <div key={k} className="row-between small" style={{ padding: '4px 0' }}><span style={{ textTransform: 'capitalize' }}>{k.replace('_', ' ')}</span><span className="mono">{(counts && counts[k]) || 0}</span></div>
      ))}
    </Panel>
  )
}

function Dependency({ name, ok, children }) {
  return (
    <div className="list-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{name}</div>
        <div className="small muted">{children}</div>
      </div>
      <Badge tone={ok === true ? 'success' : ok === false ? 'danger' : 'muted'}>{ok === true ? 'up' : ok === false ? 'unreachable' : 'unknown'}</Badge>
    </div>
  )
}

function ServiceHealth({ health, onRefresh, busy }) {
  const ai = health.aiService || {}
  return (
    <Panel title="Service health" aside={<Button size="sm" variant="secondary" onClick={onRefresh} disabled={busy}>{busy ? 'Checking…' : 'Re-check'}</Button>}>
      <Dependency name="Database" ok={health.database.ok}>{health.database.ok ? `Latest migration ${health.database.latestMigration} (${health.database.migrationsApplied} applied)` : 'The database did not answer.'}</Dependency>
      <Dependency name="AI service" ok={ai.reachable === true && !ai.reason ? true : ai.reachable === false ? false : null}>
        {ai.reachable === false && `Not reachable (${ai.reason || 'no response'}).`}
        {ai.reachable && ai.reason && `Reachable, but: ${ai.reason}.`}
        {ai.reachable && !ai.reason && `Speech: ${ai.speech?.state || 'unknown'} · Video analysis: ${ai.vision?.state || 'unknown'}`}
      </Dependency>
      <Dependency name="Code executor" ok={health.codeExecutor.configured === false ? null : !!health.codeExecutor.reachable}>
        {health.codeExecutor.configured === false ? 'CODE_EXECUTOR_URL is not set.' : health.codeExecutor.note}
      </Dependency>
      <p className="small muted" style={{ marginBottom: 0 }}>Checked {new Date(health.checkedAt).toLocaleTimeString()}. Each check has a short time limit; "unreachable" can also mean the service is still starting.</p>
    </Panel>
  )
}

/** Administrator overview: aggregate, database-backed counts only (no names, emails or private content) plus live service reachability. */
export default function AdminOverview() {
  const [data, setData] = useState(null)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const loadHealth = useCallback(async () => {
    setChecking(true)
    try { setHealth(await adminApi.serviceHealth()) } catch { setHealth(null) } finally { setChecking(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    adminApi.overview().then((d) => !cancelled && setData(d)).catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not load the overview.')))
    loadHealth()
    return () => { cancelled = true }
  }, [loadHealth])

  if (error) return <Panel title="Overview"><p role="alert" style={{ margin: 0 }}>{error}</p></Panel>
  if (!data) return <DashboardSkeleton label="Loading the platform overview" />

  const pending = data.organizationsByStatus.pending || 0
  const p = data.practiceLast30Days
  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHeader
        title="Platform overview"
        description="Counts from the live database. No personal data is shown on this page."
        actions={<Link to="/admin/organizations" className="btn btn-primary">Review organizations{pending ? ` (${pending})` : ''}</Link>}
      />

      {pending > 0 && (
        <div className="notice notice-warning row-between">
          <span><strong>{pending}</strong> organization{pending === 1 ? ' is' : 's are'} waiting for approval{data.oldestPendingOrganizationAt ? ` (oldest since ${new Date(data.oldestPendingOrganizationAt).toLocaleDateString()})` : ''}. Hirers cannot publish jobs until approved.</span>
          <Link to="/admin/organizations" className="btn btn-secondary btn-sm">Review</Link>
        </div>
      )}

      <div className="grid grid-4">
        <StatCard label="Users" value={sum(data.usersByRole)} accent="indigo" hint={`${data.usersByRole.candidate || 0} candidates · ${data.usersByRole.hirer || 0} hirers · ${data.usersByRole.admin || 0} admins`} />
        <StatCard label="Organizations" value={sum(data.organizationsByStatus)} to="/admin/organizations" accent="amber" hint={`${data.organizationsByStatus.approved || 0} approved`} />
        <StatCard label="Jobs" value={sum(data.jobsByStatus)} accent="teal" hint={`${data.jobsByStatus.open || 0} open`} />
        <StatCard label="Applications" value={sum(data.applicationsByStatus)} accent="violet" hint={`${data.applicationsByStatus.hired || 0} hired`} />
      </div>

      <div className="grid grid-2">
        <Panel title="New accounts per week" aside={<span className="small muted">last 8 weeks</span>}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={data.signupsByWeek.map((w) => ({ week: w.week.slice(5), accounts: w.n }))} margin={{ left: -18, right: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip content={<ChartTooltip labelFormatter={(l) => `Week of ${l}`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="accounts" name="Accounts" fill={CHART.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Practice activity" aside={<span className="small muted">last 30 days, candidate practice only</span>}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <StatCard label="Active candidates" value={p.activeCandidates} accent="indigo" />
            <StatCard label="Interviews completed" value={p.interviewsCompleted} accent="amber" hint={`${p.interviewsStarted} started`} />
            <StatCard label="Code submissions" value={p.codeSubmissions} accent="teal" hint={`${p.codeSubmissionsPassed} passed`} />
          </div>
        </Panel>
      </div>

      <div className="grid grid-3">
        <Breakdown title="Organizations by status" counts={data.organizationsByStatus} order={['pending', 'approved', 'rejected', 'suspended']} />
        <Breakdown title="Jobs by status" counts={data.jobsByStatus} order={['draft', 'open', 'closed']} />
        <Breakdown title="Applications by status" counts={data.applicationsByStatus} order={['submitted', 'under_review', 'shortlisted', 'rejected', 'hired', 'withdrawn']} />
      </div>

      <div className="grid grid-2">
        {health ? <ServiceHealth health={health} onRefresh={loadHealth} busy={checking} /> : (
          <Panel title="Service health" aside={<Button size="sm" variant="secondary" onClick={loadHealth} disabled={checking}>{checking ? 'Checking…' : 'Check now'}</Button>}>
            <p className="muted" style={{ margin: 0 }}>{checking ? 'Checking services…' : 'Service status could not be read.'}</p>
          </Panel>
        )}
        <Panel title="Candidate-data access by hirers" aside={<span className="small muted">last 30 days</span>}>
          {data.dataAccessLast30Days.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No hiring team has opened candidate resumes or assessments in this period.</p> : data.dataAccessLast30Days.map((a) => (
            <div key={a.action} className="row-between small" style={{ padding: '4px 0' }}><span>{ACTION_TEXT[a.action] || a.action}</span><span className="mono">{a.count}</span></div>
          ))}
          <p className="small muted" style={{ marginBottom: 0 }}>Counts only. Each organization can see its own detailed access log; who accessed what is not shown here.</p>
        </Panel>
      </div>
    </div>
  )
}
