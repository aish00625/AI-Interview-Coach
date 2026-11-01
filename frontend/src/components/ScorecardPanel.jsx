import { useEffect, useState } from 'react'
import Card from './Card.jsx'
import Button from './Button.jsx'
import { hirerApplicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

const RECOMMENDATIONS = [
  ['strong_yes', 'Strong yes'], ['yes', 'Yes'], ['no', 'No'], ['strong_no', 'Strong no'],
]
const label = (v) => (RECOMMENDATIONS.find(([k]) => k === v) || [v, v])[1]

/**
 * A structured scorecard written by a human reviewer. Nothing here is calculated or turned into a decision.
 * Colleagues' scorecards are shown only after you submit yours (or once screening is finished) so opinions stay independent.
 */
export default function ScorecardPanel({ applicationId, scorecards, canReview, onChange }) {
  const mine = scorecards.mine
  const [ratings, setRatings] = useState({})
  const [comments, setComments] = useState({})
  const [recommendation, setRecommendation] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const r = {}; const c = {}
    for (const x of mine?.ratings || []) { r[x.key] = x.rating; c[x.key] = x.comment || '' }
    setRatings(r); setComments(c); setRecommendation(mine?.recommendation || ''); setSummary(mine?.summary || '')
  }, [mine])

  async function submit(e) {
    e.preventDefault()
    setError(''); setSaved(false)
    const missing = scorecards.criteria.filter((c) => !ratings[c.key])
    if (missing.length) return setError(`Rate every criterion. Missing: ${missing.map((m) => m.label).join(', ')}.`)
    if (!recommendation) return setError('Choose a recommendation.')
    setBusy(true)
    try {
      const next = await hirerApplicationApi.submitScorecard(applicationId, {
        recommendation, summary: summary.trim() || null,
        ratings: scorecards.criteria.map((c) => ({ key: c.key, rating: Number(ratings[c.key]), comment: (comments[c.key] || '').trim() || null })),
      })
      onChange(next); setSaved(true)
    } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Card style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Scorecard</h3>
      <p style={{ color: 'var(--text-500)', fontSize: 13, marginTop: 0 }}>
        Your own judgement, 1 (weak) to 5 (strong) per criterion. {scorecards.othersHidden
          ? `${scorecards.othersCount} colleague${scorecards.othersCount === 1 ? ' has' : 's have'} already submitted; their scorecards appear after you submit yours.`
          : scorecards.othersCount ? `${scorecards.othersCount} colleague scorecard${scorecards.othersCount === 1 ? '' : 's'} below.` : 'No colleague has submitted one yet.'}
      </p>
      {canReview ? (
        <form onSubmit={submit}>
          {scorecards.criteria.map((c) => (
            <div key={c.key} style={{ borderTop: '1px solid var(--border-400)', padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 160 }}>{c.label}</strong>
                <div role="radiogroup" aria-label={c.label} style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={Number(ratings[c.key]) === n}
                      className={Number(ratings[c.key]) === n ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setRatings((r) => ({ ...r, [c.key]: n }))}>{n}</button>
                  ))}
                </div>
              </div>
              <input className="input" style={{ marginTop: 6 }} placeholder="Evidence or comment (optional)" maxLength={1000}
                value={comments[c.key] || ''} onChange={(e) => setComments((x) => ({ ...x, [c.key]: e.target.value }))} />
            </div>
          ))}
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="recommendation">Recommendation</label>
            <select id="recommendation" className="select" value={recommendation} onChange={(e) => setRecommendation(e.target.value)}>
              <option value="">Choose...</option>
              {RECOMMENDATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="scSummary">Summary (optional)</label>
            <textarea id="scSummary" className="input" rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
          {saved && <div style={{ color: 'var(--text-500)', marginBottom: 8 }}>Scorecard saved.</div>}
          <Button type="submit" disabled={busy}>{busy ? 'Saving...' : mine ? 'Update my scorecard' : 'Submit my scorecard'}</Button>
        </form>
      ) : <p style={{ color: 'var(--text-500)' }}>Your role does not allow writing scorecards.</p>}

      {scorecards.others.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 4 }}>Colleagues&apos; scorecards</h4>
          {scorecards.others.map((s) => (
            <div key={s.id} style={{ borderTop: '1px solid var(--border-400)', padding: '8px 0' }}>
              <strong>{s.reviewerName || 'Former team member'}</strong> — {label(s.recommendation)}
              <ul style={{ margin: '4px 0' }}>
                {s.ratings.map((r) => <li key={r.key}>{r.label}: {r.rating}/5{r.comment ? ` — ${r.comment}` : ''}</li>)}
              </ul>
              {s.summary && <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-500)' }}>{s.summary}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
