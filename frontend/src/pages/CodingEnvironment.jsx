import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import CodeEditor from '../components/CodeEditor.jsx'
import RunResults from '../components/RunResults.jsx'
import CodeCoachPanel from '../components/CodeCoachPanel.jsx'
import HintsPanel from '../components/HintsPanel.jsx'
import ExecutionSummary from '../components/ExecutionSummary.jsx'
import { codingApi } from '../services/api.js'
import { initialCode, saveDraft, loadLanguage, saveLanguage } from '../utils/codeDrafts.js'
import { problemNeighbours } from '../utils/problemNav.js'

const LANGUAGE_OPTIONS = [
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
]

/**
 * Phase 9: submitting now actually executes the code — inside an
 * isolated Docker container, via the code-executor service — instead of
 * just saving it. Only aggregate/safe results ever reach this page: a
 * pass/fail per test index, counts, timing, and (for a compile/runtime
 * failure) a short safe error message. Hidden test inputs and expected
 * outputs are never part of the API response at all, at any point in
 * this pipeline — see backend/README.md's Phase 9 section.
 */
function readPref(key) { try { return localStorage.getItem(key) } catch { return null } }
function savePref(key, value) { try { localStorage.setItem(key, value) } catch { /* not remembered: fine */ } }

export default function CodingEnvironment() {
  const { id } = useParams()
  // ?application=<id> marks this as a hiring assessment attempt for that application (server re-verifies everything).
  const [searchParams] = useSearchParams()
  const applicationId = Number(searchParams.get('application')) || null

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [problem, setProblem] = useState(null)
  const [language, setLanguage] = useState(() => loadLanguage('javascript'))
  const [code, setCode] = useState('')
  const [problemList, setProblemList] = useState(null) // real, ordered list used for Previous / Next (null = not loaded or unavailable)
  const navigate = useNavigate()
  const busyRef = useRef(false) // blocks a second Run/Submit while one is in flight, even on a double click
  const draftTarget = useRef(null) // which problem+language the editor text belongs to, so a draft is never saved under the wrong key
  const [submission, setSubmission] = useState(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  // Editor layout preferences (per browser, optional): wide editor, text size. Height is dragged with the corner handle.
  const [wideEditor, setWideEditor] = useState(() => readPref('aic-editor-wide') === '1')
  const [editorFont, setEditorFont] = useState(() => { const n = Number(readPref('aic-editor-font')); return n >= 11 && n <= 24 ? n : 14 })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    codingApi.getCodingProblem(id)
      .then((data) => {
        if (cancelled) return
        setProblem(data)
        // Keep the language the student was using; restore their unsaved code for this problem if there is any.
        const lang = ['cpp', 'java', 'python', 'javascript'].includes(language) ? language : 'javascript'
        setLanguage(lang)
        draftTarget.current = { problemId: data.id, language: lang }
        setCode(initialCode(data.id, lang, data.starterCode?.[lang] || ''))
        setSubmission(null); setRunResult(null); setRunError(''); setSubmitError('')
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err.response?.status === 404 ? 'This problem could not be found.' : 'Could not load this problem. Please try again.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `language` is only read as the starting language when a problem loads
  }, [id])

  // The full, ordered list (same endpoint as the Problems page, no filters) gives Previous / Next their real neighbours.
  // Not used inside a job assessment, which is about one specific problem. If it fails, only Previous / Next are hidden.
  useEffect(() => {
    if (applicationId) return undefined
    let cancelled = false
    codingApi.getCodingProblems().then((list) => { if (!cancelled) setProblemList(Array.isArray(list) ? list : null) }).catch(() => { if (!cancelled) setProblemList(null) })
    return () => { cancelled = true }
  }, [applicationId])

  // Unsaved code is kept per problem and language for this browser tab, so moving between problems never erases it.
  useEffect(() => {
    const t = draftTarget.current
    if (!problem || !t || String(t.problemId) !== String(problem.id) || t.language !== language) return
    saveDraft(problem.id, language, code, problem.starterCode?.[language] || '')
  }, [code, language, problem])

  function handleLanguageChange(e) {
    const lang = e.target.value
    if (!problem) return
    saveDraft(problem.id, language, code, problem.starterCode?.[language] || '') // current language's work is kept
    draftTarget.current = { problemId: problem.id, language: lang }
    setLanguage(lang)
    saveLanguage(lang)
    setCode(initialCode(problem.id, lang, problem.starterCode?.[lang] || ''))
    setSubmission(null)
    setRunResult(null)
  }

  const nav = applicationId ? null : problemNeighbours(problemList, id)
  const goToProblem = (p) => { if (p) navigate(`/coding/${p.id}`) }

  async function handleRun() {
    // Sample tests only, nothing saved, no assessment attempt used (the server enforces this - see POST /api/coding/run).
    if (busyRef.current) return
    busyRef.current = true
    setRunning(true); setRunError(''); setSubmission(null); setSubmitError('')
    try {
      setRunResult(await codingApi.runCode({ problemId: problem.id, language, sourceCode: code }))
    } catch (err) {
      setRunResult(null)
      if (err.response?.status === 503) setRunError('Code execution service is currently unavailable. Please try again later. (This does not mean your code failed — it could not be run.)')
      else if (err.response?.status === 429) setRunError(err.response?.data?.message || 'You are running code too quickly. Please wait a moment.')
      else setRunError(err.response?.data?.message || 'Could not run your code. Please try again.')
    } finally {
      busyRef.current = false
      setRunning(false)
    }
  }

  async function handleSubmit() {
    if (busyRef.current) return
    busyRef.current = true
    setSubmitting(true)
    setSubmitError('')
    setRunError('')
    setRunResult(null)
    setSubmission(null)
    try {
      const result = await codingApi.createSubmission({ problemId: problem.id, language, sourceCode: code, ...(applicationId ? { applicationId } : {}) })
      setSubmission(result)
    } catch (err) {
      if (err.response?.status === 503) {
        setSubmitError('Code execution service is currently unavailable. Please try again later. (This does not mean your code failed — we were unable to run it at all.)')
      } else {
        setSubmitError(err.response?.data?.message || 'Could not submit your code. Please try again.')
      }
    } finally {
      busyRef.current = false
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <LoadingSpinner label="Loading problem..." />
      </div>
    )
  }

  if (loadError) {
    return <Card><p style={{ margin: 0 }}>{loadError}</p></Card>
  }

  return (
    <div>
      {applicationId && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ margin: 0 }}>
            Job assessment attempt — your result is shared with the hiring team and attempts are limited.{' '}
            <Link to={`/applications/${applicationId}`}>Back to my application</Link>
          </p>
        </Card>
      )}
      <div className="code-header">
        <div className="code-nav" role="navigation" aria-label="Problem navigation">
          {!applicationId && <Link to="/coding" className="btn btn-secondary btn-sm">All Problems</Link>}
          {nav && nav.index !== -1 && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!nav.prev} onClick={() => goToProblem(nav.prev)}
                aria-label={nav.prev ? `Previous problem: ${nav.prev.title}` : 'Previous problem (this is the first problem)'} title={nav.prev ? nav.prev.title : 'This is the first problem'}>
                &larr; Previous
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!nav.next} onClick={() => goToProblem(nav.next)}
                aria-label={nav.next ? `Next problem: ${nav.next.title}` : 'Next problem (this is the last problem)'} title={nav.next ? nav.next.title : 'This is the last problem'}>
                Next &rarr;
              </button>
              <span className="small muted" aria-live="polite">Problem {nav.index + 1} of {nav.total}</span>
            </>
          )}
        </div>
        <div className="code-title">
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>{problem.title}</h1>
          <span className={`badge badge-${problem.difficulty}`}>{problem.difficulty}</span>
        </div>
      </div>

      <div className={`code-layout${wideEditor ? ' wide' : ''}`}>
        <Card>
          {problem.topic && <span className="badge" style={{ marginBottom: 12, display: 'inline-block' }}>{problem.topic}</span>}
          <h3>Problem Statement</h3>
          <p>{problem.description}</p>

          {problem.examples?.length > 0 && (
            <>
              <h4>Examples</h4>
              {problem.examples.map((ex, i) => (
                <pre key={i} className="mono" style={{ background: 'var(--ink-900)', padding: 10, borderRadius: 6, fontSize: '0.82rem', overflowX: 'auto' }}>
Input: {ex.input}{'\n'}Output: {ex.output}{ex.explanation ? `\n${ex.explanation}` : ''}
                </pre>
              ))}
            </>
          )}

          {problem.constraints && (
            <>
              <h4>Constraints</h4>
              <pre className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-500)', whiteSpace: 'pre-wrap' }}>{problem.constraints}</pre>
            </>
          )}
        </Card>

        <div>
          <div className="code-toolbar">
            <div className="code-lang">
              <Select options={LANGUAGE_OPTIONS} value={language} onChange={handleLanguageChange} aria-label="Programming language" />
            </div>
            <div className="code-actions">
              <Button variant="secondary" onClick={handleRun} disabled={running || submitting || !code.trim()}>{running ? 'Running...' : 'Run Code'}</Button>
              <Button onClick={handleSubmit} disabled={submitting || running || !code.trim()}>
                {submitting ? 'Running...' : 'Submit Code'}
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" aria-pressed={wideEditor} onClick={() => { setWideEditor((w) => { savePref('aic-editor-wide', w ? '0' : '1'); return !w }) }}>
              {wideEditor ? 'Normal width' : 'Wide editor'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Smaller text" onClick={() => setEditorFont((f) => { const n = Math.max(11, f - 1); savePref('aic-editor-font', String(n)); return n })}>A-</button>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Larger text" onClick={() => setEditorFont((f) => { const n = Math.min(24, f + 1); savePref('aic-editor-font', String(n)); return n })}>A+</button>
            <span className="small muted">Drag the bottom-right corner of the editor to make it taller or shorter.</span>
          </div>
          {/* resize: vertical gives the browser's own drag handle; Monaco follows through automaticLayout */}
          <div style={{ border: '1px solid var(--border-500)', borderRadius: 8, overflow: 'hidden', height: 520, minHeight: 240, maxHeight: '85vh', resize: 'vertical' }}>
            <CodeEditor language={language} value={code} onChange={setCode} fontSize={editorFont} />
          </div>

          <Card style={{ marginTop: 14, minHeight: 70 }}>
            <h4 style={{ marginBottom: 8 }}>Output</h4>
            {submission ? (
              <div>
                <ExecutionSummary submission={submission} />

                {submission.tests?.length > 0 && (
                  <div className="exec-tests" aria-label="Per-test results">
                    {submission.tests.map((t) => (
                      <span
                        key={t.index}
                        className="badge"
                        style={{ borderColor: t.passed ? 'var(--success)' : 'var(--danger)', color: t.passed ? 'var(--success)' : 'var(--danger)' }}
                      >
                        Test {t.index}{t.visible === false ? ' (hidden)' : ''}: {t.passed ? 'Passed' : 'Failed'}
                      </span>
                    ))}
                  </div>
                )}

                {submission.feedback && submission.status !== 'passed' && (
                  <p style={{ margin: '0 0 8px', color: 'var(--text-300)' }}>{submission.feedback}</p>
                )}

                {submission.stderr && (
                  <pre className="mono exec-stderr">{submission.stderr}</pre>
                )}

                <p style={{ margin: '8px 0 0', color: 'var(--text-500)', fontSize: '0.78rem' }}>
                  Results shown are for public/aggregate test outcomes only — hidden test inputs and expected outputs are never sent to the browser.
                </p>
              </div>
            ) : runResult ? (
              <RunResults result={runResult} />
            ) : (
              <p style={{ margin: 0, color: 'var(--text-500)' }}>Run or submit your code to see output here.</p>
            )}
            {submitError && <div className="field-error" style={{ marginTop: 10 }}>{submitError}</div>}
            {runError && <div className="field-error" style={{ marginTop: 10 }}>{runError}</div>}
          </Card>

          {/* Not offered inside a job assessment: the server refuses it there as well. */}
          {!applicationId && <CodeCoachPanel problemId={problem.id} language={language} code={code} />}

          <HintsPanel problemId={problem.id} hintCount={problem.hintCount} disabledByAssessmentContext={Boolean(applicationId)} />
        </div>
      </div>
    </div>
  )
}
