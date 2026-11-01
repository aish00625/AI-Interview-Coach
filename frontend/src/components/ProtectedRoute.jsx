import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'
import LoadingSpinner from './LoadingSpinner.jsx'

/**
 * Gate for every authenticated route. Phase 5: real check against
 * AuthContext — no bypass. While the initial "is the stored token still
 * valid?" check is in flight (isLoading), we show a spinner instead of
 * redirecting, so a valid session isn't bounced to /login for one frame
 * on every page refresh.
 */
export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <LoadingSpinner label="Checking your session..." />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
