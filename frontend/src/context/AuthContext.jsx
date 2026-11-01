import { createContext, useState, useMemo, useEffect, useCallback } from 'react'
import { authApi, TOKEN_STORAGE_KEY } from '../services/api.js'

/**
 * Real authentication state, backed by the Node/Express JWT API from
 * Phase 5. The token is kept in localStorage (see TOKEN_STORAGE_KEY in
 * services/api.js) — practical for a student project; a production
 * deployment might prefer an httpOnly cookie instead, which would trade
 * this localStorage read/write for a server-set cookie and a
 * credentials: 'include' style request, without changing this context's
 * public shape (user/token/isAuthenticated/login/register/logout).
 */
export const AuthContext = createContext(null)

function extractErrorMessage(err, fallback) {
  return err?.response?.data?.message || fallback
}

/**
 * Reads { userId, email } back out of a JWT's payload segment. This does
 * NOT verify the signature — it's only used to repopulate `user` for
 * display after a refresh; the backend still verifies every request's
 * token independently. If the token is malformed, returns null.
 */
function decodeTokenPayload(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    // role here is only a hint to render quickly; /auth/me (below) replaces it with the database value.
    return { id: payload.userId, email: payload.email, role: payload.role || null }
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  // True until the initial "is the stored token still valid?" check finishes,
  // so ProtectedRoute doesn't redirect to /login for one frame on every refresh.
  const [isLoading, setIsLoading] = useState(true)

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken(null)
    setUser(null)
  }, [])

  // Session persistence (F5 / reopening the tab): if a token is already
  // stored, decode it for a usable `user` right away (no network round
  // trip needed just to render), then confirm with the backend that the
  // token is still valid. If that check fails — expired, tampered, or
  // rejected for any other reason — the session is cleared.
  useEffect(() => {
    if (!token) {
      setIsLoading(false)
      return
    }
    const decoded = decodeTokenPayload(token)
    if (!decoded) {
      clearSession()
      setIsLoading(false)
      return
    }
    setUser((prev) => prev || decoded) // keep the fuller object login()/register() just set
    // Phase A: validate via /auth/me (works for every role, and returns the
    // authoritative role + organization). The old /users/profile check would
    // have logged hirers out, since they have no candidate profile.
    authApi
      .me()
      .then((freshUser) => setUser(freshUser))
      .catch(() => clearSession())
      .finally(() => setIsLoading(false))
    // Only re-run this on mount / if the token itself changes (e.g. after login).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function login(credentials) {
    try {
      const { token: newToken, user: loggedInUser } = await authApi.login(credentials)
      localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
      setToken(newToken)
      setUser(loggedInUser)
      return loggedInUser
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Login failed. Please try again.'))
    }
  }

  async function register(userData) {
    try {
      const { token: newToken, user: newUser } = await authApi.register(userData)
      localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
      setToken(newToken)
      setUser(newUser)
      return newUser
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Registration failed. Please try again.'))
    }
  }

  // Re-reads role/organization (e.g. after an admin approves the organization).
  async function refreshUser() {
    const freshUser = await authApi.me()
    setUser(freshUser)
    return freshUser
  }

  function logout() {
    // JWTs are stateless — there's no server-side session to destroy, so
    // clearing the client-side token and state is sufficient.
    clearSession()
  }

  const value = useMemo(
    () => ({
      user,
      token,
      role: user?.role || null,
      isAuthenticated: Boolean(token),
      isLoading,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, token, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
