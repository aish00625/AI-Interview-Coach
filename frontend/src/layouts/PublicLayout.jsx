import { Outlet } from 'react-router-dom'
import Navbar from '../components/Navbar.jsx'

export default function PublicLayout() {
  return (
    <div className="public-shell">
      <Navbar />
      <main className="public-main">
        <Outlet />
      </main>
    </div>
  )
}
