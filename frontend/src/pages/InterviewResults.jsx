import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import ScoreCard from '../components/ScoreCard.jsx'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { interviewApi } from '../services/api.js'
import AdvisoryNote from '../components/AdvisoryNote.jsx'
import ComparisonPanel from '../components/ComparisonPanel.jsx'
import StarCoachPanel from '../components/StarCoachPanel.jsx'
import { shouldOfferStar } from '../utils/starApplicability.js'
import AiReportPanel from '../components/AiReportPanel.jsx'
import AiSourceBadge from '../components/AiSourceBadge.jsx'
import ResultsQuestionView from '../components/ResultsQuestionView.jsx'
import ScoreBreakdown from '../components/ScoreBreakdown.jsx'
import { SessionDelivery, CombinedSummary } from '../components/DeliveryPanel.jsx'
import {
  ResultsSection, ResultsNav, OverallPerformance, CategoryAverages, QuestionsGlance,
  DeliverySummary, CameraSummaryCard, ImprovementPlan, PrintQuestions,
} from '../components/ResultsSections.jsx'
import { summariseResults, speechSummary, typingSummary, cameraSummary } from '../utils/resultsSummary.js'

/**
 * Session/question/answer data is real, from GET /api/interviews/:id.
 * Text-answer scores come from the real Phase 7 Python NLP evaluator
 * (concept-matching + TF-IDF — not an LLM). Voice answers (Phase 10)
 * additionally have a transcript and speech metrics, scored by the exact
 * same evaluator applied to the transcript — shown below when present.
 */
export default function InterviewResults() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [questions, setQuestions] = useState([])
  const [delivery, setDelivery] = useState(null)
  const [combined, setCombined] = useState(null)
  const [current, setCurrent] = useState(0)
  const [followUps, setFollowUps] = useState(null) // null for hiring assessments (no AI extras there)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const detail = await interviewApi.getInterview(id)
        if (cancelled) return
        setSession(detail.session)
        setQuestions(detail.questions)
        setDelivery(detail.delivery || null)
        setCombined(detail.combinedSummary || null)
        setFollowUps(Array.isArray(detail.followUps) ? detail.followUps : null)
      } catch (err) {
        if (cancelled) return
        setError(err.response?.status === 404 ? 'This interview could not be found.' : 'Could not load these results. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <LoadingSpinner label="Loading results..." />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <p style={{ margin: 0 }}>{error}</p>
        <Link to="/history"><Button variant="secondary" style={{ marginTop: 12 }}>Back to history</Button></Link>
      </Card>
    )
  }

  if (session.status !== 'completed') {
    return (
      <Card>
        <p style={{ margin: 0 }}>This interview isn't finished yet.</p>
        <Button style={{ marginTop: 12 }} onClick={() => navigate(`/interview/${id}`)}>Resume interview</Button>
      </Card>
    )
  }

  const answeredQuestions = questions.filter((q) => q.answer)
  const summary = summariseResults(questions, session)
  const speech = speechSummary(questions)
  const typing = typingSummary(questions)
  const camera = cameraSummary(questions)
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const showQuestion = (qid) => {
    const n = answeredQuestions.findIndex((x) => x.id === qid)
    if (n >= 0) {
      setCurrent(n)
      const el = document.getElementById('question-detail')
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
  const sections = [
    { id: 'overall', label: 'Overall' },
    { id: 'answers', label: 'Answers' },
    { id: 'delivery', label: 'Speaking & typing' },
    { id: 'camera', label: 'Camera' },
    { id: 'plan', label: 'Improvement plan' },
  ]

  return (
    <div className="results-page">
      <div className="results-head">
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Interview report — session #{id}</h1>
          <p className="small muted print-only" style={{ margin: '4px 0 0' }}>
            {session.target_role ? `${session.target_role} · ` : ''}{session.interview_type ? `${session.interview_type} · ` : ''}{session.difficulty ? `${session.difficulty} · ` : ''}Printed {today}
          </p>
        </div>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}>Print / download report</Button>
      </div>
      <p className="small muted no-print" style={{ margin: '4px 0 0' }}>Use Print, then choose "Save as PDF" as the destination to download this report.</p>
      <AdvisoryNote audience="candidate" />
      <ResultsNav items={sections} />

      <ResultsSection id="overall" title="A. Overall performance">
        <OverallPerformance session={session} summary={summary} />
        <details className="disclosure" style={{ margin: '14px 0 0' }}>
          <summary>How are these scores produced?</summary>
          <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>Technical: the share of the expected key concepts that your answer mentions (keyword and synonym matching).</li>
            <li>Relevance: a blend of text similarity to the question and concept coverage. Completeness: concept coverage plus answer length. Clarity: a sentence-length heuristic, independent of correctness.</li>
            <li>Skipped questions count as 0 in the final score but are left out of the averages below. Answers that could not be evaluated are left out of both and shown as "Insufficient data".</li>
            <li>For practice interviews the final score also includes measured speaking, typing and (experimental) camera signals using the weights in the breakdown. Hiring assessments use answer content only.</li>
            <li>The evaluator is a deterministic NLP rubric, not a language model. It can miss correct answers phrased in unexpected words, so treat scores as feedback, not a verdict.</li>
          </ul>
        </details>
        {!session.application_id && <ScoreBreakdown breakdown={session.score_breakdown} completed={session.status === 'completed'} />}
      </ResultsSection>

      <ResultsSection id="answers" title="B. Answer evaluation" intro="Averages use evaluated answers only. Select a question to see its full feedback.">
        <CategoryAverages summary={summary} />
        <div style={{ marginTop: 14 }}>
          <QuestionsGlance summary={summary} onSelect={showQuestion} selectedId={answeredQuestions[Math.min(current, answeredQuestions.length - 1)]?.id} />
        </div>
      </ResultsSection>

      <ResultsSection id="delivery" title="C. Speaking and delivery">
        <DeliverySummary speech={speech} typing={typing} answerMode={session.answer_mode} />
        <SessionDelivery delivery={delivery} />
        <CombinedSummary summary={combined} />
      </ResultsSection>

      <ResultsSection id="camera" title="D. Facial behaviour (experimental)">
        <CameraSummaryCard camera={camera} />
      </ResultsSection>

      <ResultsSection id="plan" title="E. Improvement plan">
        <ImprovementPlan summary={summary} />
        <div style={{ margin: '14px 0 0' }} className="no-print-break"><ComparisonPanel sessionId={id} /></div>
        {followUps && <div style={{ margin: '14px 0 0' }}><AiReportPanel sessionId={id} summary={summary} speech={speech} typing={typing} camera={camera} /></div>}
      </ResultsSection>

      <h2 id="question-detail" className="results-section-title no-print">Question detail</h2>
      {answeredQuestions.length > 0 && (() => {
        const i = Math.min(current, answeredQuestions.length - 1)
        const q = answeredQuestions[i]
        const go = (n) => setCurrent(Math.max(0, Math.min(answeredQuestions.length - 1, n)))
        return (
          <section aria-label="Question results" className="no-print" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <nav className="rv-pills" aria-label="Choose a question">
                {answeredQuestions.map((x, n) => (
                  <button key={x.id} type="button" className="rv-pill" aria-current={n === i} aria-label={`Question ${n + 1}`} onClick={() => go(n)}>{n + 1}</button>
                ))}
              </nav>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => go(i - 1)} disabled={i === 0}>&larr; Previous</Button>
                <Button onClick={() => go(i + 1)} disabled={i === answeredQuestions.length - 1}>Next &rarr;</Button>
              </div>
            </div>
            <ResultsQuestionView
              key={q.id}
              question={q}
              index={i}
              total={answeredQuestions.length}
              difficulty={session.difficulty}
              extras={(
                <div style={{ display: 'grid', gap: 14 }}>
                  {followUps && followUps.filter((f) => f.questionId === q.id && f.status !== 'open').length > 0 && (
                    <Card>
                      <h4>Follow-up conversation</h4>
                      {followUps.filter((f) => f.questionId === q.id && f.status !== 'open').map((f) => (
                        <div key={f.id} style={{ marginBottom: 10, color: 'var(--text-300)' }}>
                          <p style={{ margin: '0 0 4px' }}><AiSourceBadge source={f.source} model={f.model} /> <strong>{f.prompt}</strong></p>
                          {f.status === 'skipped' ? <p className="small muted" style={{ margin: 0 }}>Skipped.</p> : (
                            <>
                              <p style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>{f.answerText}</p>
                              {f.feedback && <p className="small" style={{ margin: 0 }}>{f.feedback.text}</p>}
                            </>
                          )}
                        </div>
                      ))}
                      <p className="small muted" style={{ margin: 0 }}>Practice only; follow-ups are not included in your scores.</p>
                    </Card>
                  )}
                  {followUps && shouldOfferStar(session.interview_type, q.question_text) && <Card><StarCoachPanel sessionId={id} questionId={q.id} /></Card>}
                  {q.answer.evaluation_meta?.followUps?.length > 0 && (
                    <Card>
                      <h4>Follow-up questions to think about</h4>
                      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-300)' }}>
                        {q.answer.evaluation_meta.followUps.map((f, idx) => <li key={idx} style={{ marginBottom: 4 }}>{f}</li>)}
                      </ul>
                      <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-500)' }}>Based on points your answer did not clearly cover. Practice only; not scored.</p>
                    </Card>
                  )}
                </div>
              )}
            />
          </section>
        )
      })()}

      <PrintQuestions summary={summary} />

      <div className="no-print" style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
        <Button onClick={() => navigate('/interview/setup')}>Practice Again</Button>
        <Link to="/dashboard"><Button variant="secondary">Back to Dashboard</Button></Link>
        <Link to="/history"><Button variant="secondary">View History</Button></Link>
      </div>
    </div>
  )
}
