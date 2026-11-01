import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Select from '../components/Select.jsx'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import { validateInterviewSetup, hasErrors } from '../utils/validation.js'
import { interviewApi } from '../services/api.js'
import { useToast } from '../context/FeedbackContext.jsx'

const HINTS = {
  interviewType: { technical: 'Concepts and problem solving for your role.', behavioral: 'Past experience and teamwork (STAR-style answers).', hr: 'Motivation, fit and general questions.', mixed: 'A blend of all three.' },
  difficulty: { easy: 'Core concepts and definitions.', medium: 'Applying concepts and trade-offs.', hard: 'Depth, edge cases and design reasoning.' },
  answerMode: { text: 'Type your answers. Typing speed and pauses are measured (counts only, never which keys).', voice: 'Speak your answers. Needs a microphone; speech rate, pauses and filler words are measured.' },
}

const INTERVIEW_TYPE_OPTIONS = [
  { value: 'technical', label: 'Technical' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'hr', label: 'HR' },
  { value: 'mixed', label: 'Mixed' },
]

const TARGET_ROLE_OPTIONS = [
  { value: 'Software Engineer', label: 'Software Engineer' },
  { value: 'Full Stack Developer', label: 'Full Stack Developer' },
  { value: 'Data Engineer', label: 'Data Engineer' },
  { value: 'Security Engineer', label: 'Security Engineer' },
  { value: 'DevOps Engineer', label: 'DevOps Engineer' },
]

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

const ANSWER_MODE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'voice', label: 'Voice' },
]

export default function InterviewSetup() {
  const navigate = useNavigate()
  const toast = useToast()
  const [micStatus, setMicStatus] = useState('') // '', 'checking', 'ok', 'denied', 'missing'
  const [form, setForm] = useState({
    interviewType: '',
    targetRole: '',
    difficulty: '',
    answerMode: 'text',
  })
  // Practice-only options. Personalise defaults on; adaptive difficulty is opt-in.
  const [practiceOptions, setPracticeOptions] = useState({ personalize: true, adaptive: false })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setServerError('')
    if (e.target.name === 'answerMode') setMicStatus('')
  }

  /** Real microphone permission check (voice mode only). The stream is stopped immediately; nothing is recorded. */
  async function checkMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicStatus('missing')
      toast.warning('This browser cannot access a microphone. Choose Text mode or use a current browser.')
      return false
    }
    setMicStatus('checking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMicStatus('ok')
      return true
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      setMicStatus(denied ? 'denied' : 'missing')
      toast.warning(denied ? 'Microphone access was blocked. Allow it in the browser address bar, or choose Text mode.' : 'No microphone was found. Connect one, or choose Text mode.')
      return false
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationErrors = validateInterviewSetup(form)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    setServerError('')
    if (form.answerMode === 'voice') {
      const ok = await checkMic()
      if (!ok) { setSubmitting(false); return }
    }
    try {
      // answerMode is sent for the backend's validator to accept, but it
      // isn't persisted (no matching column) — LiveInterview still uses
      // it as local UI state via router state below.
      const { session, personalization } = await interviewApi.createInterview({ ...form, ...practiceOptions })
      navigate(`/interview/${session.id}`, { state: { setup: form, personalization } })
    } catch (err) {
      setServerError(err.response?.data?.message || 'Could not start the interview. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem' }}>Start an interview</h1>

      <Card style={{ maxWidth: 640, width: '100%' }}>
        <form onSubmit={handleSubmit} noValidate>
          <Select
            label="Interview Type"
            name="interviewType"
            placeholder="Select interview type"
            value={form.interviewType}
            onChange={handleChange}
            options={INTERVIEW_TYPE_OPTIONS}
            error={errors.interviewType}
          />
          {HINTS.interviewType[form.interviewType] && <p className="small muted setup-hint">{HINTS.interviewType[form.interviewType]}</p>}
          <Select
            label="Target Role"
            name="targetRole"
            placeholder="Select target role"
            value={form.targetRole}
            onChange={handleChange}
            options={TARGET_ROLE_OPTIONS}
            error={errors.targetRole}
          />
          <Select
            label="Difficulty"
            name="difficulty"
            placeholder="Select difficulty"
            value={form.difficulty}
            onChange={handleChange}
            options={DIFFICULTY_OPTIONS}
            error={errors.difficulty}
          />
          {HINTS.difficulty[form.difficulty] && <p className="small muted setup-hint">{HINTS.difficulty[form.difficulty]}</p>}
          <Select
            label="Answer Mode"
            name="answerMode"
            value={form.answerMode}
            onChange={handleChange}
            options={ANSWER_MODE_OPTIONS}
          />
          <p className="small muted setup-hint">{HINTS.answerMode[form.answerMode]}</p>
          {form.answerMode === 'voice' && micStatus && (
            <p className={`small setup-hint ${micStatus === 'ok' ? '' : 'notice notice-info'}`} role="status">
              {micStatus === 'checking' && 'Checking microphone permission…'}
              {micStatus === 'ok' && 'Microphone is allowed.'}
              {micStatus === 'denied' && 'Microphone access is blocked. Allow it in the browser address bar, then try again, or switch to Text.'}
              {micStatus === 'missing' && 'No usable microphone was found. Connect one, or switch to Text.'}
            </p>
          )}
          <fieldset style={{ border: '1px solid var(--border-500)', borderRadius: 8, padding: '10px 12px', margin: '0 0 16px' }}>
            <legend style={{ fontSize: '0.8rem', color: 'var(--text-500)', padding: '0 6px' }}>Practice options (private practice only)</legend>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: '0.88rem' }}>
              <input type="checkbox" checked={practiceOptions.personalize} onChange={(e) => setPracticeOptions({ ...practiceOptions, personalize: e.target.checked })} />
              <span>Choose questions based on my profile skills, target role and weaker topics, and avoid repeating recent questions.</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem' }}>
              <input type="checkbox" checked={practiceOptions.adaptive} onChange={(e) => setPracticeOptions({ ...practiceOptions, adaptive: e.target.checked })} />
              <span>Adapt difficulty to my recent practice scores (needs at least 2 completed sessions of this type).</span>
            </label>
          </fieldset>
          <Button type="submit" block disabled={submitting}>
            {micStatus === 'checking' ? 'Checking microphone…' : submitting ? 'Starting interview...' : 'Start Interview'}
          </Button>
        </form>
        {serverError && <div role="alert" className="field-error" style={{ marginTop: 14 }}>{serverError}</div>}
      </Card>
    </div>
  )
}
