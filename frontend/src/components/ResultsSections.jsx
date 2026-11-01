import { Link } from 'react-router-dom'
import ScoreCard from './ScoreCard.jsx'
import { givenAnswer, idealAnswer, answerScores, qualityView } from '../utils/resultsView.js'

const muted = { color: 'var(--text-500)' }
const pct = (r) => `${Math.round(Number(r) * 100)}%`
const CONF_WORD = { high: 'High', medium: 'Medium', low: 'Low' }
const CONF_TEXT = {
  high: 'Most answers matched the checker\'s expected key terms, so its scores are fairly dependable.',
  medium: 'The checker found some expected key terms in many answers; treat the scores as guidance.',
  low: 'For many answers the checker had little to compare against, so treat these scores as rough.',
}

/** Section wrapper: anchor target, heading and consistent spacing. */
export function ResultsSection({ id, title, intro, children }) {
  return (
    <section id={id} className="results-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="results-section-title">{title}</h2>
      {intro && <p className="small muted results-intro">{intro}</p>}
      {children}
    </section>
  )
}

export function ResultsNav({ items }) {
  return (
    <nav className="results-nav no-print" aria-label="Results sections">
      {items.map((i) => <a key={i.id} href={`#${i.id}`}>{i.label}</a>)}
    </nav>
  )
}

/** A. Overall performance: final score, evaluation confidence (separate from quality), summary, strongest and weakest area. */
export function OverallPerformance({ session, summary }) {
  const c = summary.counts
  const dim = (d) => (d ? `${d.label} (${d.average}/100)` : null)
  return (
    <div className="results-grid-4">
      <ScoreCard label="Final score" value={session.final_score ?? '—'} />
      <div className="card">
        <div className="results-stat-label">Evaluation confidence</div>
        <div className="results-stat-value">{summary.confidence ? CONF_WORD[summary.confidence] : 'Not available'}</div>
        <div className="small" style={muted}>
          {summary.confidence
            ? `${CONF_TEXT[summary.confidence]} High ${summary.confidenceCounts.high} · Medium ${summary.confidenceCounts.medium} · Low ${summary.confidenceCounts.low}. This is about how far the automatic check can be trusted, separate from answer quality.`
            : 'No answer was evaluated, so there is nothing to give a confidence for.'}
        </div>
      </div>
      <div className="card">
        <div className="results-stat-label">Performance summary</div>
        <div className="results-stat-value">{summary.overallAverage === null ? 'No data' : `${summary.overallAverage} / 100`}</div>
        <div className="small" style={muted}>
          {summary.overallAverage === null ? 'No answer could be scored.' : 'Average of the four scores over evaluated answers.'}{' '}
          {c.evaluated} of {c.total} questions evaluated
          {c.skipped ? `, ${c.skipped} skipped (counted as 0 in the final score)` : ''}
          {c.notEvaluable ? `, ${c.notEvaluable} not evaluable` : ''}.
        </div>
      </div>
      <div className="card">
        <div className="results-stat-label">Strongest and weakest area</div>
        {summary.strongest ? (
          <ul className="results-list">
            <li><span style={muted}>Strongest:</span> <strong>{dim(summary.strongest)}</strong></li>
            <li><span style={muted}>Weakest:</span> <strong>{dim(summary.weakest)}</strong></li>
          </ul>
        ) : <div className="small" style={muted}>{summary.overallAverage === null ? 'Not enough evaluated answers.' : 'The four scores are about equal, so no area stands out.'}</div>}
      </div>
    </div>
  )
}

/** B. Four category averages (evaluated answers only) and a compact per-question table. */
export function CategoryAverages({ summary }) {
  return (
    <div className="results-grid-4">
      {summary.dimensions.map((d) => (
        <div className="card" key={d.key}>
          <div className="results-stat-label">{d.label}</div>
          <div className="results-stat-value">{d.average === null ? 'Insufficient data' : `${d.average} / 100`}</div>
          <div className="small" style={muted}>{d.average === null ? 'No evaluated answers.' : `Average over ${d.n} evaluated answer${d.n === 1 ? '' : 's'}`}</div>
        </div>
      ))}
    </div>
  )
}

export function QuestionsGlance({ summary, onSelect, selectedId }) {
  if (!summary.rows.length) return null
  return (
    <div className="scroll-x">
      <table className="results-table" aria-label="Questions at a glance">
        <thead><tr><th>#</th><th>Question</th><th>Result</th><th>Average</th><th>Confidence</th></tr></thead>
        <tbody>
          {summary.rows.map((r) => (
            <tr key={r.id} aria-selected={r.id === selectedId}>
              <td>{r.index}</td>
              <td><button type="button" className="link-button" onClick={() => onSelect(r.id)}>{r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text}</button></td>
              <td>{r.skipped ? 'Not answered (skipped)' : r.status === 'not_evaluable' ? 'Insufficient data (not evaluable)' : r.label}{r.attempts > 1 ? ` · attempt ${r.attempts}` : ''}</td>
              <td>{r.average === null ? '—' : `${r.average}`}</td>
              <td>{r.confidence ? CONF_WORD[r.confidence] : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** C. Speaking and typing, only what was measured, with the reason when nothing was. */
export function DeliverySummary({ speech, typing, answerMode }) {
  return (
    <div className="results-grid-2">
      <div className="card">
        <div className="results-stat-label">Speaking</div>
        {speech ? (
          <ul className="results-list">
            <li>{speech.answers} spoken answer{speech.answers === 1 ? '' : 's'} measured</li>
            {speech.speakingRateWpm !== null && <li>Average speaking rate: <strong>{speech.speakingRateWpm} words/min</strong></li>}
            {speech.fillerWords !== null && <li>Filler words: <strong>{speech.fillerWords}</strong></li>}
            {speech.pauses !== null && <li>Pauses: <strong>{speech.pauses}</strong>{speech.longestPauseSeconds !== null && <> (longest {speech.longestPauseSeconds}s)</>}</li>}
            {speech.timeToFirstWordSeconds !== null && <li>Average time to first word: <strong>{speech.timeToFirstWordSeconds}s</strong></li>}
            {speech.lowConfidenceTranscripts > 0 && <li style={muted}>{speech.lowConfidenceTranscripts} transcript{speech.lowConfidenceTranscripts === 1 ? ' was' : 's were'} low confidence, so its speech numbers may be off.</li>}
          </ul>
        ) : <div className="small" style={muted}>No speech was measured. Speech measurements exist only for answers given by voice{answerMode === 'text' ? '; this session used typed answers' : ''}.</div>}
      </div>
      <div className="card">
        <div className="results-stat-label">Typing</div>
        {typing ? (
          <ul className="results-list">
            <li>{typing.answers} typed answer{typing.answers === 1 ? '' : 's'} measured</li>
            {typing.typingSpeedWpm !== null && <li>Average typing speed: <strong>{typing.typingSpeedWpm} words/min</strong></li>}
            {typing.correctionRatio !== null && <li>Share of key presses that were deletions: <strong>{pct(typing.correctionRatio)}</strong></li>}
            {typing.longPauses !== null && <li>Long pauses (3s+): <strong>{typing.longPauses}</strong></li>}
            <li className="small" style={muted}>Only counts and timings are recorded, never which keys were pressed.</li>
          </ul>
        ) : <div className="small" style={muted}>No typing was measured. Typing measurements exist only for typed answers.</div>}
      </div>
    </div>
  )
}

/** D. Camera measurements across the session. Measurements only; never emotion, attention, honesty or ability. */
export function CameraSummaryCard({ camera }) {
  if (!camera) {
    return (
      <div className="card">
        <p className="small" style={{ margin: 0, ...muted }}>
          Camera analysis was not used in this session, so there are no facial behaviour measurements. It is optional and starts only if you choose Yes before the first question.
        </p>
      </div>
    )
  }
  const item = (label, v, hint) => (
    <div className="card" key={label}>
      <div className="results-stat-label">{label}</div>
      <div className="results-stat-value">{v ? pct(v.value) : 'Unavailable'}</div>
      <div className="small" style={muted}>{v ? `${hint} (average over ${v.n} answer${v.n === 1 ? '' : 's'})` : 'Not measured for this session.'}</div>
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="results-grid-3">
        {item('Face visibility', camera.facePresence, 'share of sampled frames with a face')}
        {item('Facing the camera', camera.facingCamera, 'head pointed toward the lens')}
        {item('Eye contact (approximate)', camera.eyeContact, 'a webcam only gives a rough estimate')}
      </div>
      {camera.modelUnavailable > 0 && (
        <p className="small notice notice-info" style={{ margin: 0 }}>
          For {camera.modelUnavailable} of {camera.answers} answer{camera.answers === 1 ? '' : 's'} the face-landmark model was not available, so only face visibility could be measured. Head movement, expression variation, gaze and position in frame are marked Unavailable in those answers.
        </p>
      )}
      <p className="small" style={{ margin: 0, ...muted }}>
        Experimental. These are measurements from sampled frames, not judgements. They do not detect honesty, emotion, confidence or attention, and they are not evidence of interview ability. Open a question below to see its six measurements, behaviour timeline and sample frames.
        {' '}For a longer camera check, use the <Link to="/face-monitoring">Face Monitoring</Link> page.
      </p>
    </div>
  )
}

/** E. Weak topics, recommended practice, next interview. Rule-based. */
export function ImprovementPlan({ summary }) {
  return (
    <div className="results-grid-2">
      <div className="card">
        <div className="results-stat-label">Weak topics</div>
        {summary.weakTopics.length ? (
          <ul className="results-list">{summary.weakTopics.map((t) => <li key={t.topic}><strong>{t.topic}</strong> <span style={muted}>average {t.average}/100 over {t.answers} answer{t.answers === 1 ? '' : 's'}</span></li>)}</ul>
        ) : <div className="small" style={muted}>No topic averaged below 60/100 in this session.</div>}
        {summary.insufficientTopics.length > 0 && (
          <p className="small" style={{ margin: '8px 0 0', ...muted }}>Insufficient data (all answers skipped or not evaluable, so not judged weak): {summary.insufficientTopics.map((t) => t.topic).join(', ')}.</p>
        )}
        {summary.lowestQuestions.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="small" style={muted}>Lowest-scoring questions</div>
            <ul className="results-list">{summary.lowestQuestions.map((r) => <li key={r.id}>Q{r.index}: {r.text.length > 80 ? `${r.text.slice(0, 80)}…` : r.text} <strong>({r.average})</strong></li>)}</ul>
          </div>
        )}
      </div>
      <div className="card">
        <div className="results-stat-label">Recommended practice and next steps</div>
        {summary.nextSteps.length ? <ul className="results-list">{summary.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul> : <div className="small" style={muted}>No specific weak spots found.</div>}
        <p style={{ margin: '10px 0 6px' }}><strong>Suggested next interview:</strong> {summary.suggestedNext}</p>
        <Link to="/interview/setup" className="btn btn-secondary btn-sm no-print">Start a new interview</Link>
        <p className="small" style={{ margin: '10px 0 0', ...muted }}>Suggestions come from fixed rules over your scores. They are not AI-generated and not a prediction.</p>
      </div>
    </div>
  )
}

/** Print-only: every question with its result, feedback and model answer (the screen view shows one question at a time). */
export function PrintQuestions({ summary }) {
  return (
    <section className="print-only" aria-label="All questions">
      <h2 className="results-section-title">Question-by-question feedback</h2>
      {summary.rows.map((r) => {
        const a = r.answer
        const given = givenAnswer(a)
        const ideal = idealAnswer(a)
        const q = qualityView(a)
        const strengths = Array.isArray(a.strengths) ? a.strengths : []
        const weaknesses = Array.isArray(a.weaknesses) ? a.weaknesses : []
        return (
          <article key={r.id} className="print-question">
            <h3>Q{r.index}. {r.text}</h3>
            <p className="small">{r.topic ? `Topic: ${r.topic} · ` : ''}Result: {r.skipped ? 'Not answered (skipped, counts as 0)' : r.status === 'not_evaluable' ? 'Insufficient data (not evaluable)' : r.label}
              {r.average !== null ? ` · Average ${r.average}/100` : ''}{r.confidence ? ` · Evaluation confidence ${r.confidence}` : ''}</p>
            {r.evaluable && <p className="small">{answerScores(a).map((s) => `${s.label}: ${s.value === null ? 'n/a' : Math.round(s.value)}`).join(' · ')}</p>}
            {q && q.reasons.length > 0 && <p className="small">Why: {q.reasons.join(' ')}</p>}
            {given.text && <p className="small"><strong>Your answer:</strong> {given.text}</p>}
            {strengths.length > 0 && <p className="small"><strong>Strengths:</strong> {strengths.join(' ')}</p>}
            {weaknesses.length > 0 && <p className="small"><strong>To improve:</strong> {weaknesses.join(' ')}</p>}
            {a.suggested_improvement && <p className="small"><strong>Suggestion:</strong> {a.suggested_improvement}</p>}
            {ideal.kind === 'available' && <p className="small"><strong>Reference answer:</strong> {ideal.text}</p>}
          </article>
        )
      })}
    </section>
  )
}

