import { useEffect, useMemo, useState } from 'react'
import Select from '../components/Select.jsx'
import CodingProblemCard from '../components/CodingProblemCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import Panel from '../components/Panel.jsx'
import { Skeleton } from '../components/Skeleton.jsx'
import { codingApi, topicApi } from '../services/api.js'
import { buildProgressMap, countSolved, progressFor, statusFor } from '../utils/codingProgress.js'

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]
const STATUS_OPTIONS = [
  { value: 'unsolved', label: 'Not solved yet' },
  { value: 'solved', label: 'Solved' },
  { value: 'attempted', label: 'Attempted, not solved' },
  { value: 'new', label: 'Not started' },
]

function truncate(text, max = 110) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max).trim()}…` : text
}

/**
 * Real problems from GET /api/coding/problems. Hidden test cases are never part of that response (see codingModel.js).
 * Solved / attempted badges come from GET /api/coding/progress (my own practice only); if that call fails the list still
 * works, just without badges. The status filter is applied in the browser on the already-loaded list.
 */
export default function CodingProblems() {
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  const [topicOptions, setTopicOptions] = useState([])
  const [problems, setProblems] = useState([])
  const [progress, setProgress] = useState(new Map())
  const [progressLoaded, setProgressLoaded] = useState(false) // true once /coding/progress answered (even with no rows)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    topicApi.getTopics()
      .then((topics) => setTopicOptions(topics.map((t) => ({ value: t.name, label: t.name }))))
      .catch(() => setTopicOptions([])) // non-critical - filter dropdown just stays empty
    codingApi.getProgress()
      .then((rows) => { setProgress(buildProgressMap(rows)); setProgressLoaded(true) })
      .catch(() => { setProgress(new Map()); setProgressLoaded(false) }) // non-critical - no badges
  }, [])

  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(() => {
      setLoading(true)
      setError('')
      codingApi.getCodingProblems({ topic: topic || undefined, difficulty: difficulty || undefined, search: search || undefined })
        .then((data) => { if (!cancelled) setProblems(data) })
        .catch(() => { if (!cancelled) setError('Could not load coding problems. Please try again.') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250) // debounce the search input so every keystroke doesn't fire a request
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [topic, difficulty, search])

  const visible = useMemo(() => problems.filter((p) => {
    const st = statusFor(progress, p.id)
    if (!status) return true
    if (status === 'unsolved') return st !== 'solved'
    return st === status
  }), [problems, progress, status])

  const solvedCount = countSolved(problems, progress)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHeader
        title="Coding problems"
        description={loading ? 'Loading the problem bank…' : `${problems.length} problem${problems.length === 1 ? '' : 's'} match your filters${progressLoaded ? ` · you have solved ${solvedCount} of them` : ''}.`}
      />

      <Panel>
        <div className="row" role="search" aria-label="Filter coding problems">
          <input className="input" style={{ maxWidth: 240 }} placeholder="Search by title..." aria-label="Search by title" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select placeholder="All topics" options={topicOptions} value={topic} onChange={(e) => setTopic(e.target.value)} />
          <Select placeholder="All difficulties" options={DIFFICULTY_OPTIONS} value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
          <Select placeholder="Any status" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
        </div>
      </Panel>

      {loading ? (
        <div className="grid grid-3" role="status" aria-busy="true" aria-label="Loading problems">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={150} style={{ borderRadius: 12 }} />)}
        </div>
      ) : error ? (
        <Panel><p role="alert" style={{ margin: 0 }}>{error}</p></Panel>
      ) : visible.length === 0 ? (
        <EmptyState title="No problems match those filters" description="Try clearing a filter or search term." />
      ) : (
        <div className="grid grid-3">
          {visible.map((problem) => (
            <CodingProblemCard
              key={problem.id}
              problem={{ ...problem, shortDescription: truncate(problem.description), status: progressFor(progress, problem.id)?.status, attempts: progressFor(progress, problem.id)?.attempts }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
