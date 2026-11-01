import { useEffect, useState } from 'react'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import SkillSelector from '../components/SkillSelector.jsx'
import ResumeSkillSuggestions from '../components/ResumeSkillSuggestions.jsx'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { profileApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

const EXPERIENCE_OPTIONS = [
  { value: 'fresher', label: 'Fresher' },
  { value: 'experienced', label: 'Experienced' },
]

// Matches profiles.preferred_language CHECK constraint in database/schema.sql
const LANGUAGE_OPTIONS = [
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
]

/**
 * The candidate's profile, loaded from and saved to the backend (GET/PUT /api/users/profile).
 * Experience level is used for job eligibility checks and skills for job-fit and hirer skill-match,
 * so saving here has real consequences elsewhere. Name and email come from the account and are read-only.
 */
export default function Profile() {
  const { user } = useAuth()
  const [form, setForm] = useState({ targetRole: '', experienceLevel: 'fresher', preferredLanguage: 'javascript', skills: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    profileApi.getProfile()
      .then((p) => {
        if (cancelled) return
        setForm({
          targetRole: p.target_role || '',
          experienceLevel: p.experience_level || 'fresher',
          preferredLanguage: p.preferred_language || 'javascript',
          skills: (p.skills || []).map((s) => s.name),
        })
      })
      .catch((err) => { if (!cancelled) setLoadError(apiErrorMessage(err, 'Could not load your profile.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setSaved(false)
  }

  function handleSkillsChange(skills) {
    setForm({ ...form, skills })
    setSaved(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    setSaved(false)
    try {
      const p = await profileApi.updateProfile({
        targetRole: form.targetRole.trim(),
        experienceLevel: form.experienceLevel,
        preferredLanguage: form.preferredLanguage,
        skillNames: form.skills,
      })
      // Show exactly what the server stored (skill names are normalised server-side).
      setForm({
        targetRole: p.target_role || '',
        experienceLevel: p.experience_level,
        preferredLanguage: p.preferred_language,
        skills: (p.skills || []).map((s) => s.name),
      })
      setSaved(true)
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'Could not save your profile.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><LoadingSpinner label="Loading profile..." /></div>
  if (loadError) return <Card><p style={{ margin: 0 }}>{loadError}</p></Card>

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem' }}>Profile</h1>
      <p style={{ color: 'var(--text-500)' }}>
        Your experience level decides which jobs you can apply to, and your skills are compared with each job's required skills.
      </p>

      <Card style={{ maxWidth: 520 }}>
        <form onSubmit={handleSubmit}>
          <Input label="Name" name="name" value={user?.name || ''} readOnly />
          <Input label="Email" name="email" type="email" value={user?.email || ''} readOnly />
          <Input label="Target Role" name="targetRole" value={form.targetRole} onChange={handleChange} maxLength={100} placeholder="e.g. Full Stack Developer" />
          <Select label="Experience Level" name="experienceLevel" value={form.experienceLevel} onChange={handleChange} options={EXPERIENCE_OPTIONS} />
          <Select label="Preferred Programming Language" name="preferredLanguage" value={form.preferredLanguage} onChange={handleChange} options={LANGUAGE_OPTIONS} />
          <SkillSelector value={form.skills} onChange={handleSkillsChange} />
          <ResumeSkillSuggestions currentSkills={form.skills} onAdd={(name) => handleSkillsChange([...form.skills, name])} />
          <Button type="submit" block disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</Button>
        </form>
        {saved && <div role="status" style={{ marginTop: 14, color: 'var(--success)', fontSize: '0.85rem' }}>Profile saved.</div>}
        {saveError && <div role="alert" style={{ marginTop: 14, color: 'var(--danger)', fontSize: '0.85rem' }}>{saveError}</div>}
      </Card>
    </div>
  )
}
