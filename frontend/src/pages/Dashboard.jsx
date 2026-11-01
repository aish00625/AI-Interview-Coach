import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts'
import PageHeader from '../components/PageHeader.jsx'
import Panel from '../components/Panel.jsx'
import StatCard from '../components/StatCard.jsx'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Heatmap from '../components/Heatmap.jsx'
import ReadinessRing from '../components/ReadinessRing.jsx'
import TopicMap from '../components/TopicMap.jsx'
import GoalsPanel from '../components/GoalsPanel.jsx'
import DailyPlanPanel from '../components/DailyPlanPanel.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import { DashboardSkeleton } from '../components/Skeleton.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { dashboardApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { CHART, axisProps } from '../utils/chartTheme.js'

const STEP_ICON = { continue: '▶', review: '↻', goal: '◎', coding: '</>', start: '★' }
const DIFFICULTY_TONE = { easy: 'success', medium: 'warning', hard: 'danger' }

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

function NextSteps({ steps }) {
  if (!steps.length) return <p className="muted" style={{ margin: 0 }}>Nothing urgent. Keep your streak going with a practice interview or a coding problem.</p>
  return (
    <div className="stack" style={{ gap: 10 }}>
      {steps.map((s) => (
        <Link key={s.id} to={s.link} className="next-step">
          <span className="next-step-icon" aria-hidden="true">{STEP_ICON[s.type] || '•'}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-100)' }}>{s.title}</span>
            <span className="small muted">{s.reason}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}

function ReviewQueue({ due, upcoming }) {
  if (!due.length && !upcoming.length) {
    return <p className="muted small" style={{ margin: 0 }}>Review reminders appear once you have scored practice on a topic. Each topic comes back after 1–14 days depending on how well it is going.</p>
  }
  return (
    <div>
      {due.length === 0 && <p className="small muted" style={{ marginTop: 0 }}>Nothing is due for review right now.</p>}
      {due.map((r) => (
        <div key={r.topic} className="list-row">
          <div>
            <div style={{ fontWeight: 600 }}>{r.topic}</div>
            <div className="small muted">Last practised {r.lastPracticedDaysAgo} day{r.lastPracticedDaysAgo === 1 ? '' : 's'} ago · {r.status} ({r.score}%)</div>
          </div>
          <Badge tone={r.overdueDays > 0 ? 'warning' : 'info'}>{r.overdueDays > 0 ? `${r.overdueDays}d overdue` : 'due today'}</Badge>
        </div>
      ))}
      {upcoming.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>Coming up</div>
          {upcoming.map((r) => (
            <div key={r.topic} className="row-between small" style={{ padding: '3px 0' }}>
              <span>{r.topic}</span><span className="muted">{formatDate(r.dueAt)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="small muted" style={{ margin: '10px 0 0' }}>Suggested schedule only (weak 1 day, developing 3, good 7, strong 14); it is not a proven memory model.</p>
    </div>
  )
}

function CodingProgress({ coding }) {
  const total = coding.byDifficulty.reduce((s, d) => s + d.total, 0)
  if (!total) return <EmptyState title="No coding problems available" description="Problems will appear here once the bank is loaded." />
  return (
    <div className="stack" style={{ gap: 14 }}>
      {coding.byDifficulty.map((d) => (
        <div key={d.difficulty}>
          <div className="row-between small">
            <span><Badge tone={DIFFICULTY_TONE[d.difficulty] || 'neutral'}>{d.difficulty}</Badge> <span className="muted">{d.solved} solved · {d.attempted} attempted · {d.total} available</span></span>
            <span className="mono">{d.total ? Math.round((100 * d.solved) / d.total) : 0}%</span>
          </div>
          <div className="meter" role="progressbar" aria-label={`${d.difficulty} problems solved`} aria-valuemin={0} aria-valuemax={d.total} aria-valuenow={d.solved} style={{ marginTop: 6 }}>
            <span style={{ width: `${d.total ? (100 * d.solved) / d.total : 0}%` }} />
          </div>
        </div>
      ))}
      {coding.byLanguage.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Submissions by language</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={coding.byLanguage} margin={{ left: -18, right: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="language" {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="attempted" name="Attempted" fill={CHART.neutral} radius={[4, 4, 0, 0]} />
              <Bar dataKey="solved" name="Passed" fill={CHART.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {coding.topicSuccess.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Success by topic (distinct problems solved ÷ attempted)</div>
          {coding.topicSuccess.map((t) => (
            <div key={t.topic} style={{ marginBottom: 8 }}>
              <div className="row-between small"><span>{t.topic}</span><span className="muted">{t.solved}/{t.attempted} · {t.rate}%</span></div>
              <div className="meter amber"><span style={{ width: `${t.rate}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Candidate command center. One request (GET /api/dashboard/preparation) returns everything, computed on the server
 * from the signed-in candidate's own practice records. Anything without data is null/empty from the API and shown as
 * an em dash or an explanatory empty state - never a made-up number.
 */
export default function Dashboard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    try {
      setError('')
      setData(await dashboardApi.getPreparation())
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load your dashboard. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <DashboardSkeleton label="Loading your dashboard" />
  if (error && !data) {
    return (
      <Panel title="Dashboard">
        <p role="alert" style={{ marginTop: 0 }}>{error}</p>
        <Button onClick={() => { setLoading(true); load() }}>Try again</Button>
      </Panel>
    )
  }

  const d = data
  const firstName = (user?.name || '').split(' ')[0]
  const o = d.overview

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Your preparation'}
        description={d.hasAnyActivity
          ? 'Everything below is calculated from your own practice records, so it only reflects what you have actually done here.'
          : 'No practice recorded yet. Your first interview or coding problem unlocks your score trend, topic map and review reminders.'}
        actions={(
          <>
            <Link to="/interview/setup" className="btn btn-primary">Start an interview</Link>
            <Link to="/coding" className="btn btn-secondary">Practice coding</Link>
          </>
        )}
      />

      {d.continueInterview && (
        <div className="notice notice-info row-between">
          <span>You have an unfinished <strong>{d.continueInterview.targetRole}</strong> interview ({d.continueInterview.difficulty}).</span>
          <Link to={`/interview/${d.continueInterview.id}`} className="btn btn-secondary btn-sm">Continue</Link>
        </div>
      )}

      <div className="grid grid-4">
        <StatCard label="Interviews completed" value={o.completedInterviews} to="/history" accent="indigo" hint={o.totalInterviews > o.completedInterviews ? `${o.totalInterviews - o.completedInterviews} unfinished` : null} />
        <StatCard label="Average interview score" value={o.averageInterviewScore == null ? null : Math.round(o.averageInterviewScore)} unit="/100" to="/progress" accent="amber" hint="Mean of completed practice interviews" />
        <StatCard label="Coding problems solved" value={o.distinctProblemsSolved} to="/coding" accent="teal" hint={`${o.distinctProblemsAttempted} attempted`} />
        <StatCard label="Coding success rate" value={o.codingSuccessRate} unit="%" to="/progress" accent="violet" hint="Passed ÷ all your submissions" />
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          <ReadinessRing readiness={d.readiness} />

          <Panel title="Interview score trend" to="/progress" linkLabel="Full progress">
            {d.scoreOverTime.length === 0 ? (
              <EmptyState title="No completed interviews yet" description="Finish one practice interview to start your score trend." action={<Link to="/interview/setup" className="btn btn-primary">Start an interview</Link>} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d.scoreOverTime.map((s, i) => ({ session: `#${i + 1}`, date: formatDate(s.date), score: s.score }))} margin={{ left: -16, right: 8, top: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="session" {...axisProps} />
                  <YAxis domain={[0, 100]} {...axisProps} />
                  <Tooltip content={<ChartTooltip unit="/100" labelFormatter={(l) => `Interview ${l}`} />} />
                  <Line type="monotone" dataKey="score" name="Score" stroke={CHART.primary} strokeWidth={2.5} dot={{ r: 3, fill: CHART.primary }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Knowledge-gap map" aside={<span className="small muted">from your interview answers and coding results</span>}>
            {d.hasAnyActivity ? <TopicMap subjects={d.gapMap.subjects} thresholds={d.gapMap.thresholds} /> : (
              <EmptyState title="Your topic map is empty" description="Answer interview questions or solve problems and each topic will show how it is going, with the evidence." />
            )}
          </Panel>

          <Panel title="Coding progress" to="/coding" linkLabel="Open problems">
            <CodingProgress coding={d.coding} />
          </Panel>
        </div>

        <div className="stack">
          <DailyPlanPanel />

          <Panel title="What to do next">
            <NextSteps steps={d.nextSteps} />
          </Panel>

          <GoalsPanel goals={d.goals} onSaved={load} />

          <Panel title="Practice streak">
            <div className="row" style={{ marginBottom: 12, gap: 24 }}>
              <div><div className="stat-value" style={{ color: 'var(--indigo-500)' }}>{d.streak.current}<span className="unit"> day{d.streak.current === 1 ? '' : 's'}</span></div><div className="small muted">current streak</div></div>
              <div><div className="stat-value">{d.streak.longest}<span className="unit"> day{d.streak.longest === 1 ? '' : 's'}</span></div><div className="small muted">longest</div></div>
            </div>
            <Heatmap cells={d.heatmap.days} totalActions={d.heatmap.totalActions} activeDays={d.heatmap.activeDays} />
          </Panel>

          <Panel title="Due for review">
            <ReviewQueue due={d.reviewQueue} upcoming={d.upcomingReviews} />
          </Panel>

          <Panel title="Recent activity" to="/history" linkLabel="History">
            {d.recentActivity.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Your interviews and code submissions will be listed here.</p>
            ) : d.recentActivity.map((item) => (
              <div key={`${item.type}-${item.id}`} className="list-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}><Badge tone={item.type === 'interview' ? 'violet' : 'info'}>{item.type === 'interview' ? 'Interview' : 'Coding'}</Badge> {item.title}</div>
                  <div className="small muted">{formatDate(item.date)} · {item.status}</div>
                </div>
                {item.score != null && <span className="mono" style={{ color: 'var(--accent-amber)' }}>{item.score}</span>}
              </div>
            ))}
          </Panel>
        </div>
      </div>

      <details className="disclosure">
        <summary>How these numbers are produced</summary>
        <ul className="small muted" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
          {d.methodology.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </details>
    </div>
  )
}
