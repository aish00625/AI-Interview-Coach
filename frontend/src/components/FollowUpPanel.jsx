import { useState } from 'react'
import Button from './Button.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import AiSourceBadge from './AiSourceBadge.jsx'
import { interviewApi } from '../services/api.js'
import { describeAiError } from '../utils/aiErrors.js'

/**
 * Optional multi-turn follow-ups for a practice interview, shown after a question has been answered.
 * Follow-up answers are practice only: they never change the scores above. Nothing here blocks "Next Question".
 */
export default function FollowUpPanel({ sessionId, questionId }) {
  const [turns, setTurns] = useState([])          // finished turns (answered or skipped)
  const [open, setOpen] = useState(null)          // the follow-up currently being answered
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')            // 'ask' | 'answer' | 'skip' | ''
  const [notice, setNotice] = useState(null)      // { message, retry }
  const [canAskAnother, setCanAskAnother] = useState(true)
  const [maxTurns, setMaxTurns] = useState(null)
  const [started, setStarted] = useState(false)

  async function ask() {
    setBusy('ask'); setNotice(null)
    try {
      const out = await interviewApi.requestFollowUp(sessionId, questionId)
      setStarted(true)
      if (out.maxTurns) setMaxTurns(out.maxTurns)
      if (out.available) { setOpen(out.followUp); setText('') }
      else setNotice({ message: out.message || 'No follow-up question is available for this answer.', retry: out.retryable !== false && out.reason !== 'no_follow_up' })
    } catch (err) {
      const info = describeAiError(err, 'Could not get a follow-up question.')
      setNotice({ message: info.message, retry: true })
    } finally { setBusy('') }
  }

  async function answer(e) {
    e.preventDefault()
    setBusy('answer'); setNotice(null)
    try {
      const out = await interviewApi.answerFollowUp(sessionId, open.id, text)
      setTurns((t) => [...t, out.followUp]); setOpen(null); setText('')
      setCanAskAnother(out.canAskAnother !== false)
      if (out.feedbackUnavailable) setNotice({ message: `${out.feedbackUnavailable.message || 'Feedback on this answer is not available right now.'} Your answer was saved.`, retry: false })
    } catch (err) {
      setNotice({ message: describeAiError(err, 'Could not save your follow-up answer.').message, retry: true })
    } finally { setBusy('') }
  }

  async function skip() {
    setBusy('skip'); setNotice(null)
    try {
      const out = await interviewApi.skipFollowUp(sessionId, open.id)
      setTurns((t) => [...t, out.followUp]); setOpen(null); setText('')
    } catch (err) {
      setNotice({ message: describeAiError(err, 'Could not skip this follow-up.').message, retry: true })
    } finally { setBusy('') }
  }

  return (
    <section className="panel" style={{ marginTop: 16 }} aria-label="Follow-up question">
      <div className="panel-header">
        <h2 className="panel-title">Go deeper (optional)</h2>
        <span className="small muted">Practice only - never changes your scores</span>
      </div>

      {turns.map((t) => (
        <div key={t.id} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-500)' }}>
          <p style={{ margin: '0 0 6px' }}><AiSourceBadge source={t.source} model={t.model} /> <strong>{t.prompt}</strong></p>
          {t.status === 'skipped'
            ? <p className="small muted" style={{ margin: 0 }}>Skipped.</p>
            : (
              <>
                <p style={{ margin: '0 0 6px', color: 'var(--text-300)', whiteSpace: 'pre-wrap' }}>{t.answerText}</p>
                {t.feedback ? (
                  <div className="small" style={{ color: 'var(--text-300)' }}>
                    <p style={{ margin: '0 0 4px' }}><AiSourceBadge source={t.feedback.source} model={t.feedback.model} /> {t.feedback.text}</p>
                    {t.feedback.strength && <p style={{ margin: '0 0 2px' }}><strong>Good:</strong> {t.feedback.strength}</p>}
                    {t.feedback.improve && <p style={{ margin: 0 }}><strong>Try next time:</strong> {t.feedback.improve}</p>}
                  </div>
                ) : <p className="small muted" style={{ margin: 0 }}>No AI feedback was available for this answer.</p>}
              </>
            )}
        </div>
      ))}

      {open && (
        <form onSubmit={answer}>
          <p style={{ margin: '0 0 8px' }}><AiSourceBadge source={open.source} model={open.model} /> <strong>{open.prompt}</strong></p>
          {open.reason && <p className="small muted" style={{ margin: '0 0 8px' }}>Why this question: {open.reason}</p>}
          <label htmlFor={`fu-${open.id}`} className="small muted">Your answer</label>
          <textarea id={`fu-${open.id}`} className="input" rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} disabled={Boolean(busy)} placeholder="Type your answer..." />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <Button type="submit" disabled={Boolean(busy) || !text.trim()}>{busy === 'answer' ? 'Getting feedback...' : 'Submit follow-up answer'}</Button>
            <Button type="button" variant="secondary" onClick={skip} disabled={Boolean(busy)}>{busy === 'skip' ? 'Skipping...' : 'Skip this follow-up'}</Button>
          </div>
          {busy === 'answer' && <div style={{ marginTop: 10 }}><LoadingSpinner label="The local model is reading your answer (this can take up to a minute on a laptop)..." /></div>}
        </form>
      )}

      {!open && busy === 'ask' && <LoadingSpinner label="Thinking of a follow-up question..." />}

      {!open && busy !== 'ask' && canAskAnother && (
        <div>
          {!started && turns.length === 0 && <p className="small muted" style={{ margin: '0 0 10px' }}>Get a follow-up question based on your answer, like a real interviewer would ask. You can skip it at any time.</p>}
          <Button variant="secondary" onClick={ask}>{turns.length ? 'Ask another follow-up' : 'Ask me a follow-up'}</Button>
        </div>
      )}
      {!open && !canAskAnother && <p className="small muted" style={{ margin: 0 }}>That is the maximum of {maxTurns || 'a few'} follow-ups for this question. Continue to the next question when you are ready.</p>}

      {notice && (
        <div role="alert" className="notice notice-info" style={{ marginTop: 12 }}>
          {notice.message}
          {notice.retry && !open && busy === '' && <div style={{ marginTop: 8 }}><Button variant="secondary" size="sm" onClick={ask}>Try again</Button></div>}
        </div>
      )}
    </section>
  )
}
