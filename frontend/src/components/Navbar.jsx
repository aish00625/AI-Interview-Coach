import { Link } from 'react-router-dom'

/** Top navigation for the public (unauthenticated) pages. */
export default function Navbar() {
  return (
    <header style={{ borderBottom: '1px solid var(--border-500)' }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-100)' }}>
          prepline<span style={{ color: 'var(--accent-amber)' }}>_</span>
        </Link>
        <nav style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Link to="/login" style={{ color: 'var(--text-300)' }}>Log in</Link>
          <Link to="/register" className="btn btn-primary">Create account</Link>
        </nav>
      </div>
    </header>
  )
}
