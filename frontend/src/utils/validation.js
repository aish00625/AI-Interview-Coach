/**
 * Lightweight client-side validation helpers.
 * These are UX guardrails only — the backend (added later) is the real
 * source of truth and will re-validate everything server-side.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateLogin({ email, password }) {
  const errors = {}
  if (!email) errors.email = 'Email is required.'
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.'
  if (!password) errors.password = 'Password is required.'
  return errors
}

export function validateRegister({ name, email, password, confirmPassword, role, companyName }) {
  const errors = {}
  if (role === 'hirer' && !(companyName || '').trim()) errors.companyName = 'Company name is required.'
  if (!name) errors.name = 'Name is required.'
  if (!email) errors.email = 'Email is required.'
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.'
  if (!password) errors.password = 'Password is required.'
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters.'
  if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.'
  return errors
}

export function validateInterviewSetup({ interviewType, targetRole, difficulty }) {
  const errors = {}
  if (!interviewType) errors.interviewType = 'Select an interview type.'
  if (!targetRole) errors.targetRole = 'Select a target role.'
  if (!difficulty) errors.difficulty = 'Select a difficulty.'
  return errors
}

export const hasErrors = (errors) => Object.keys(errors).length > 0
