import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'
import { homePathFor } from '../utils/roles.js'

/**
 * Role gate, nested INSIDE ProtectedRoute (which has already handled
 * "not logged in" and the loading state). Sends a signed-in user whose role
 * isn't allowed to their own home page. This is a UX convenience only — the
 * backend enforces the same rules (requireRole) on every API call.
 */
export default function RoleRoute({ allow }) {
  const { role } = useAuth()
  if (!allow.includes(role)) {
    return <Navigate to={homePathFor(role)} replace />
  }
  return <Outlet />
}
