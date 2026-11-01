import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import { validateRegister, hasErrors } from '../utils/validation.js'
import { useAuth } from '../hooks/useAuth.js'
import { homePathFor } from '../utils/roles.js'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  // A hiring-team invitation link looks like /register?invite=<64 hex characters>. It creates a hiring account that joins
  // the inviting organization (the e-mail must be the invited address).
  const [searchParams] = useSearchParams()
  const inviteToken = /^[0-9a-f]{64}$/.test(searchParams.get('invite') || '') ? searchParams.get('invite') : ''
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', role: inviteToken ? 'hirer' : 'candidate', companyName: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setServerError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationErrors = validateRegister(inviteToken ? { ...form, companyName: 'invited' } : form)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    setServerError('')
    try {
      // confirmPassword is a frontend-only check — never sent to the backend.
      const payload = { name: form.name, email: form.email, password: form.password, role: form.role }
      if (inviteToken) payload.inviteToken = inviteToken
      else if (form.role === 'hirer') payload.companyName = form.companyName.trim()
      const newUser = await register(payload)
      navigate(homePathFor(newUser?.role))
    } catch (err) {
      // register() already normalizes this to a clean message (e.g. "email already exists").
      setServerError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 72 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Create your account</h1>

      <Card>
        <form onSubmit={handleSubmit} noValidate>
          {inviteToken && (
            <p role="note" style={{ border: '1px solid var(--border-400)', borderRadius: 6, padding: '8px 12px' }}>
              You were invited to join a hiring team. Register with the e-mail address the invitation was sent to.
            </p>
          )}
          {!inviteToken && <div className="field">
            <label>I am signing up as</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['candidate', 'A candidate'], ['hirer', 'Hiring for a company']].map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  className={form.role === value ? 'btn btn-primary' : 'btn btn-secondary'}
                  aria-pressed={form.role === value}
                  onClick={() => setForm({ ...form, role: value })}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>}
          {form.role === 'hirer' && !inviteToken && (
            <>
              <Input label="Company name" name="companyName" value={form.companyName} onChange={handleChange} error={errors.companyName} />
              <p style={{ color: 'var(--text-500)', fontSize: '0.85rem', marginTop: -4 }}>
                Hiring accounts need approval by an administrator before you can see candidates.
              </p>
            </>
          )}
          <Input label="Name" name="name" value={form.name} onChange={handleChange} error={errors.name} />
          <Input label="Email" name="email" type="email" value={form.email} onChange={handleChange} error={errors.email} />
          <Input label="Password" name="password" type="password" value={form.password} onChange={handleChange} error={errors.password} />
          <Input
            label="Confirm password"
            name="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={handleChange}
            error={errors.confirmPassword}
          />
          <Button type="submit" block disabled={submitting}>
            {submitting ? 'Creating account...' : 'Create account'}
          </Button>
        </form>
        {serverError && (
          <div className="field-error" style={{ marginTop: 14 }}>{serverError}</div>
        )}
      </Card>

      <p style={{ marginTop: 16 }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  )
}
