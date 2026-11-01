import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Input from '../components/Input.jsx'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import { validateLogin, hasErrors } from '../utils/validation.js'
import { useAuth } from '../hooks/useAuth.js'
import { homePathFor } from '../utils/roles.js'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setServerError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationErrors = validateLogin(form)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    setServerError('')
    try {
      const loggedInUser = await login(form)
      navigate(homePathFor(loggedInUser?.role))
    } catch (err) {
      // login() already normalizes this to a clean message — never the raw backend error.
      setServerError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 72 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Log in</h1>

      <Card>
        <form onSubmit={handleSubmit} noValidate>
          <Input
            label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            error={errors.email}
          />
          <Input
            label="Password"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            error={errors.password}
          />
          <Button type="submit" block disabled={submitting}>
            {submitting ? 'Logging in...' : 'Log in'}
          </Button>
        </form>
        {serverError && (
          <div className="field-error" style={{ marginTop: 14 }}>{serverError}</div>
        )}
      </Card>

      <p style={{ marginTop: 16 }}>
        No account? <Link to="/register">Create one</Link>
      </p>
    </div>
  )
}
