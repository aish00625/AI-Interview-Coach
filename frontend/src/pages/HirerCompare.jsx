import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerApplicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { statusLabel } from '../utils/applicationLabels.js'
import AdvisoryNote from '../components/AdvisoryNote.jsx'

const fmt = (v, suffix = '') => (v == null ? '—' : `${Math.round(v * 10) / 10}${suffix}`)

/** Side-by-side comparison. Highlights the best value per row; there is no automatic ranking or decision. */
export default function HirerCompare() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const ids = (params.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)

  useEffect(() => {
    let cancelled = false
    hirerApplicationApi.compare(id, ids)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not compare these candidates.')))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, params.toString()])

  if (error) return <div><Link to={`/hirer/jobs/${id}/applicants`}>← Applicants</Link><div className="field-error" style={{ marginTop: 12 }}>{error}</div></div>
  if (!data) return <LoadingSpinner label="Loading comparison..." />

  const rows = [
    { label: 'Status', value: (c) => statusLabel(c.status) },
    { label: 'Experience', value: (c) => c.experience_level || '—' },
    { label: 'Skill match', value: (c) => (c.skill_match_percent == null ? '—' : `${c.skill_match_percent}% (${c.skills_matched}/${c.skills_required})`), score: (c) => c.skill_match_percent },
    { label: 'Missing skills', value: (c) => (c.missing_skills.length ? c.missing_skills.join(', ') : 'None') },
    { label: 'Assessment results shared', value: (c) => (c.consent_assessment ? 'Yes' : 'Not shared by the candidate') },
    { label: 'Scorecards submitted', value: (c) => String(c.scorecard_count ?? 0) },
    { label: 'Interview overall', value: (c) => fmt(c.interview_score, '/100'), score: (c) => c.interview_score },
    { label: 'Answers to treat with caution', value: (c) => {
      if (c.answers_total == null) return '—'
      const parts = []
      if (c.answers_not_evaluable) parts.push(`${c.answers_not_evaluable} not evaluable`)
      if (c.answers_low_confidence) parts.push(`${c.answers_low_confidence} low confidence`)
      return parts.length ? `${parts.join(', ')} of ${c.answers_total}` : `None of ${c.answers_total}`
    } },
    { label: 'Technical (avg)', value: (c) => fmt(c.avg_technical), score: (c) => c.avg_technical },
    { label: 'Relevance (avg)', value: (c) => fmt(c.avg_relevance), score: (c) => c.avg_relevance },
    { label: 'Clarity (avg)', value: (c) => fmt(c.avg_clarity), score: (c) => c.avg_clarity },
    { label: 'Completeness (avg)', value: (c) => fmt(c.avg_completeness), score: (c) => c.avg_completeness },
    { label: 'Coding problems solved', value: (c) => (c.coding_problems_assigned ? `${c.coding_problems_passed}/${c.coding_problems_assigned}` : '—'), score: (c) => (c.coding_problems_assigned ? c.coding_problems_passed : null) },
  ]

  return (
    <div>
      <Link to={`/hirer/jobs/${id}/applicants`}>← Applicants</Link>
      <h1>Compare candidates — {data.job.title}</h1>
      <p style={{ color: 'var(--text-500)', fontSize: 13 }}>Highlighted cells are the highest value in that row. Scores are indicative; use them alongside the resume and your own judgement. Answers the evaluator could not read count as 0 in the averages, and answers marked low confidence have less reliable scores.</p>
      <AdvisoryNote />
      <Card style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th></th>
              {data.candidates.map((c) => <th key={c.id}><Link to={`/hirer/applications/${c.id}`}>{c.candidate_name}</Link></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const scores = r.score ? data.candidates.map(r.score).filter((v) => v != null) : []
              const best = scores.length > 1 ? Math.max(...scores) : null
              return (
                <tr key={r.label} style={{ borderTop: '1px solid var(--border-400)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px 8px 0' }}>{r.label}</th>
                  {data.candidates.map((c) => {
                    const isBest = best != null && r.score(c) === best
                    return <td key={c.id} style={{ padding: '8px 12px 8px 0', fontWeight: isBest ? 700 : 400, color: isBest ? 'var(--accent-amber)' : undefined }}>{r.value(c)}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
