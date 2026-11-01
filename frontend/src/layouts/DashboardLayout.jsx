import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'

export default function DashboardLayout() {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Sidebar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <Suspense fallback={<LoadingSpinner label="Loading page…" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
