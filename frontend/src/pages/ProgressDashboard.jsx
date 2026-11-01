import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import PageHeader from '../components/PageHeader.jsx'
import Panel from '../components/Panel.jsx'
import StatCard from '../components/StatCard.jsx'
import Badge from '../components/Badge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Heatmap from '../components/Heatmap.jsx'
import TopicMap from '../components/TopicMap.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import Button from '../components/Button.jsx'
import { DashboardSkeleton } from '../components/Skeleton.jsx'
import { dashboardApi } from '../services/api.js'
import { CHART, axisProps } from '../utils/chartTheme.js'

const scoreOrNull = (v) => (v == null ? null : Math.round(v))

/**
 * Detailed progress. Two server calls, both scoped to the signed-in candidate: GET /api/performance (the established
 * breakdowns) and GET /api/dashboard/preparation (heatmap, streak, topic map). If the second one fails the page still
 * shows everything from the first. Missing data is null/empty from the API and shown as a dash or an empty state.
 */
export default function ProgressDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [prep, setPrep] = useState(null)

  async function load() {
    setLoading(true); setError('')
    const [perf, preparation] = await Promise.allSettled([dashboardApi.getPerformance(), dashboardApi.getPreparation()])
    if (perf.status === 'fulfilled') setData(perf.value)
    else setError('Could not load your progress. Please try again.')
    if (preparation.status === 'fulfilled') setPrep(preparation.value)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <DashboardSkeleton label="Loading your progress" />
  if (error || !data) {
    return (
      <Panel title="Progress">
        <p role="alert" style={{ marginTop: 0 }}>{error || 'Could not load your progress.'}</p>
        <Button onClick={load}>Try again</Button>
      </Panel>
    )
  }

  const scoreOverTimeData = data.scoreOverTime.map((s, i) => ({ session: `#${i + 1}`, score: s.score }))
  const topicChartData = data.topicPerformance.map((t) => ({ topic: t.topic, score: t.averageScore }))
  const strongest = data.strongestTopics || []
  const weakest = data.weakestTopics || []

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHeader
        title="Progress"
        description="How your interview and coding practice is going over time, with the evidence behind each number."
        actions={<Link to="/dashboard" className="btn btn-secondary">Back to dashboard</Link>}
      />

      <div className="grid grid-4">
        <StatCard label="Overall interview score" value={scoreOrNull(data.overallScore)} unit="/100" accent="amber" />
        <StatCard label="Coding pass rate" value={data.codingScore} unit="%" accent="teal" hint="Passed ÷ all submissions" />
        <StatCard label="Technical interview score" value={scoreOrNull(data.technicalInterviewScore)} unit="/100" accent="indigo" />
        <StatCard label="Answer clarity" value={scoreOrNull(data.communicationScore)} unit="/100" accent="violet" hint="Clarity of written/transcribed answers" />
      </div>

      <Panel title="Score over time">
        {scoreOverTimeData.length === 0 ? (
          <EmptyState title="No completed interviews yet" description="Your score trend will appear here once you finish one." action={<Link to="/interview/setup" className="btn btn-primary">Start an interview</Link>} />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={scoreOverTimeData} margin={{ left: -16, right: 8, top: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="session" {...axisProps} />
              <YAxis domain={[0, 100]} {...axisProps} />
              <Tooltip content={<ChartTooltip unit="/100" labelFormatter={(l) => `Interview ${l}`} />} />
              <Line type="monotone" dataKey="score" name="Score" stroke={CHART.primary} strokeWidth={2.5} dot={{ r: 3, fill: CHART.primary }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {prep && (
        <div className="grid grid-main-side">
          <Panel title="Daily practice activity">
            <div className="row" style={{ marginBottom: 12, gap: 24 }}>
              <div><div className="stat-value" style={{ color: 'var(--indigo-500)' }}>{prep.streak.current}<span className="unit"> days</span></div><div className="small muted">current streak</div></div>
              <div><div className="stat-value">{prep.streak.longest}<span className="unit"> days</span></div><div className="small muted">longest streak</div></div>
              <div><div className="stat-value">{prep.streak.activeDaysLast14}<span className="unit">/14</span></div><div className="small muted">active days, last 2 weeks</div></div>
            </div>
            <Heatmap cells={prep.heatmap.days} totalActions={prep.heatmap.totalActions} activeDays={prep.heatmap.activeDays} />
            <p className="small muted" style={{ marginBottom: 0 }}>Each square is one UTC day. An action is an interview answer or a code submission.</p>
          </Panel>
          <Panel title="Strongest and weakest topics">
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Strongest (interview answers)</div>
                {strongest.length === 0 ? <span className="small muted">Not enough scored answers yet.</span> : strongest.map((t) => (
                  <div key={t.topic} className="row-between small" style={{ padding: '3px 0' }}><span>{t.topic}</span><Badge tone="success">{Math.round(t.averageScore)}%</Badge></div>
                ))}
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Needs the most work</div>
                {weakest.length === 0 ? <span className="small muted">Not enough scored answers yet.</span> : weakest.map((t) => (
                  <div key={t.topic} className="row-between small" style={{ padding: '3px 0' }}><span>{t.topic}</span><Badge tone="warning">{Math.round(t.averageScore)}%</Badge></div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      )}

      <div className="grid grid-2">
        <Panel title="Coding performance by difficulty">
          {data.codingByDifficulty.length === 0 ? (
            <EmptyState title="No coding submissions yet" description="Solve a coding problem to see your accuracy here." action={<Link to="/coding" className="btn btn-primary">Browse problems</Link>} />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={data.codingByDifficulty} margin={{ left: -16, right: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="difficulty" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="attempted" name="Submissions" fill={CHART.neutral} radius={[4, 4, 0, 0]} />
                <Bar dataKey="solved" name="Passed" fill={CHART.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Interview score by topic">
          {topicChartData.length === 0 ? (
            <EmptyState title="No topic data yet" description="Answer interview questions across topics to see a breakdown here." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(230, topicChartData.length * 34)}>
              <BarChart data={topicChartData} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} {...axisProps} />
                <YAxis type="category" dataKey="topic" width={110} {...axisProps} />
                <Tooltip content={<ChartTooltip unit="%" />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="score" name="Average score" fill={CHART.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {prep && prep.coding.byLanguage.length > 0 && (
        <Panel title="Submissions by language">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Language</th><th>Submissions</th><th>Passed</th><th>Pass rate</th></tr></thead>
              <tbody>
                {prep.coding.byLanguage.map((l) => (
                  <tr key={l.language}><td>{l.language}</td><td>{l.attempted}</td><td>{l.solved}</td><td>{l.attempted ? `${Math.round((100 * l.solved) / l.attempted)}%` : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {prep && prep.hasAnyActivity && (
        <Panel title="Knowledge-gap map">
          <TopicMap subjects={prep.gapMap.subjects} thresholds={prep.gapMap.thresholds} />
        </Panel>
      )}

      <div className="grid grid-2">
        <Panel title="Interviews by type">
          {data.interviewsByType.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No interviews yet.</p>
          ) : (
            <div className="row">{data.interviewsByType.map((t) => <span key={t.type} className="badge">{t.type}: {t.count}</span>)}</div>
          )}
        </Panel>
        <Panel title="Interviews by difficulty">
          {data.interviewsByDifficulty.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No interviews yet.</p>
          ) : (
            <div className="row">{data.interviewsByDifficulty.map((d) => <span key={d.difficulty} className={`badge badge-${d.difficulty}`}>{d.difficulty}: {d.count}</span>)}</div>
          )}
        </Panel>
      </div>
    </div>
  )
}
