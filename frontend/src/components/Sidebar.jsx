import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { notificationApi } from '../services/api.js'
import { useAuth } from '../hooks/useAuth.js'

import { NAV_LINKS } from '../utils/roles.js'

/** Unread-notification count: refreshed on mount, every 60 s, and when the Notifications page changes something. Failures just hide the badge. */
function useUnreadCount(enabled) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const refresh = () => notificationApi.unreadCount().then((n) => !cancelled && setCount(n)).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('notifications-changed', refresh)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('notifications-changed', refresh) }
  }, [enabled])
  return count
}

export default function Sidebar() {
  const { logout, role, user } = useAuth()
  const memberRole = user?.organization?.memberRole
  const links = (NAV_LINKS[role] || NAV_LINKS.candidate).filter((l) => (!l.ownerOnly || memberRole === 'owner') && (!l.builderOnly || ['owner', 'recruiter'].includes(memberRole)))
  const unread = useUnreadCount(role === 'candidate')
  const navigate = useNavigate()

  function handleLogout() {
    // Uses the real AuthContext logout — there is no fake session to clear
    // yet since login isn't implemented until Phase 5, but this wiring
    // will work unchanged once it is.
    logout()
    navigate('/')
  }

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        prepline<span style={{ color: 'var(--accent-amber)' }}>_</span>
      </div>
      <nav className="sidebar-nav">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            {link.label}
            {link.badge === 'notifications' && unread > 0 && <span className="badge badge-violet" style={{ marginLeft: 8 }} aria-label={`${unread} unread`}>{unread}</span>}
          </NavLink>
        ))}
      </nav>
      <button type="button" onClick={handleLogout} className="sidebar-logout">
        Log out
      </button>
    </aside>
  )
}
