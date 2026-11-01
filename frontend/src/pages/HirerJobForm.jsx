import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import SkillSelector from '../components/SkillSelector.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerJobApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS } from '../utils/jobLabels.js'

const EMPTY = {
  title: '', description: '', location: '', employmentType: 'full_time', experienceLevel: 'any',
  eligibilityCriteria: '', closesAt: '', skills: [], blindReview: false, scorecardCriteria: '',
}

const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

/** Create (no :id) or edit (:id) a job. New jobs are saved as drafts; publish from the job list. */
export default function HirerJobForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    hirerJobApi.get(id)
      .then((job) => {
        if (cancelled) return
        setForm({
          title: job.title, description: job.description, location: job.location || '',
          employmentType: job.employment_type, experienceLevel: job.experience_level,
          eligibilityCriteria: job.eligibility_criteria || '', closesAt: toDateInput(job.closes_at),
          blindReview: Boolean(job.blind_review),
          scorecardCriteria: (job.scorecard_criteria || []).map((c) => c.label).join('\n'),
          skills: job.required_skills.map((s) => s.name),
          optional: job.required_skills.filter((s) => !s.mandatory).map((s) => s.name),
        })
      })
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not load this job.')))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [id])

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) return setError('Job title is required.')
    if (!form.description.trim()) return setError('Job description is required.')
    const optional = new Set((form.optional || []).map((n) => n.toLowerCase()))
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      location: form.location.trim() || null,
      employmentType: form.employmentType,
      experienceLevel: form.experienceLevel,
      eligibilityCriteria: form.eligibilityCriteria.trim() || null,
      closesAt: form.closesAt ? new Date(`${form.closesAt}T23:59:59`).toISOString() : null,
      blindReview: Boolean(form.blindReview),
      scorecardCriteria: form.scorecardCriteria.split('\n').map((l) => l.trim()).filter(Boolean),
      requiredSkills: form.skills.map((name) => ({ name, mandatory: !optional.has(name.toLowerCase()) })),
    }
    setSaving(true)
    try {
      if (id) await hirerJobApi.update(id, payload)
      else await hirerJobApi.create(payload)
      navigate('/hirer/jobs')
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner label="Loading job..." />

  return (
    <div>
      <h1>{id ? 'Edit job' : 'New job'}</h1>
      <Card>
        <form onSubmit={submit} noValidate>
          <Input label="Job title" name="title" value={form.title} onChange={set('title')} maxLength={150} />
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea id="description" className="input" rows={8} value={form.description} onChange={set('description')} maxLength={10000} />
          </div>
          <Input label="Location" name="location" value={form.location} onChange={set('location')} maxLength={150} />
          <Select label="Employment type" name="employmentType" value={form.employmentType} onChange={set('employmentType')} options={EMPLOYMENT_TYPES} />
          <Select label="Experience level" name="experienceLevel" value={form.experienceLevel} onChange={set('experienceLevel')} options={EXPERIENCE_LEVELS} />
          <div className="field">
            <label htmlFor="eligibilityCriteria">Eligibility criteria</label>
            <textarea id="eligibilityCriteria" className="input" rows={4} value={form.eligibilityCriteria} onChange={set('eligibilityCriteria')} maxLength={5000} placeholder="e.g. B.E./B.Tech in CS, 2025 graduates, no active backlogs" />
          </div>
          <Input label="Applications close on (optional)" name="closesAt" type="date" value={form.closesAt} onChange={set('closesAt')} />
          <SkillSelector value={form.skills} onChange={(skills) => setForm((f) => ({ ...f, skills }))} />
          <p style={{ color: 'var(--text-500)', fontSize: 13 }}>All listed skills are treated as required. At least one skill is needed before you can publish.</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '12px 0' }}>
            <input type="checkbox" checked={form.blindReview} onChange={(e) => setForm((f) => ({ ...f, blindReview: e.target.checked }))} style={{ marginTop: 4 }} />
            <span><strong>Blind review.</strong> Hide candidate names, e-mails, resumes and cover notes from your team while applications are being screened. Identity is revealed when an application is shortlisted. Answers and code are still shown and may contain personal details.</span>
          </label>
          <div className="field">
            <label htmlFor="scorecardCriteria">Scorecard criteria (optional, one per line, up to 8)</label>
            <textarea id="scorecardCriteria" className="input" rows={4} value={form.scorecardCriteria} onChange={set('scorecardCriteria')} placeholder={'Leave empty to use: Technical skills, Problem solving, Communication, Fit for the role'} />
          </div>
          {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : id ? 'Save changes' : 'Save as draft'}</Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/hirer/jobs')}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
