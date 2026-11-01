// Where each role lands after login/registration, and which sidebar links it gets.
export const ROLES = { CANDIDATE: 'candidate', HIRER: 'hirer', ADMIN: 'admin' }

export function homePathFor(role) {
  if (role === ROLES.HIRER) return '/hirer/dashboard'
  if (role === ROLES.ADMIN) return '/admin/overview'
  return '/dashboard'
}

export const NAV_LINKS = {
  candidate: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/interview/setup', label: 'New Interview' },
    { to: '/jobs', label: 'Job Board' },
    { to: '/applications', label: 'My Applications' },
    { to: '/assessments', label: 'My Assessments' },
    { to: '/resumes', label: 'My Resumes' },
    { to: '/coding', label: 'Coding Problems' },
    { to: '/progress', label: 'Progress' },
    { to: '/history', label: 'History' },
    { to: '/face-monitoring', label: 'Camera check (beta)' },
    { to: '/notifications', label: 'Notifications', badge: 'notifications' },
    { to: '/profile', label: 'Profile' },
    { to: '/account', label: 'Account' },
  ],
  hirer: [
    { to: '/hirer/dashboard', label: 'Hiring Dashboard' },
    { to: '/hirer/jobs', label: 'Job Openings' },
    { to: '/hirer/assessments', label: 'Assessments' },
    { to: '/hirer/question-bank', label: 'Question bank', builderOnly: true },
    { to: '/hirer/team', label: 'Team' },
    { to: '/hirer/audit-log', label: 'Access log', ownerOnly: true },
    { to: '/account', label: 'Account' },
  ],
  admin: [
    { to: '/admin/overview', label: 'Overview' },
    { to: '/admin/organizations', label: 'Organizations' },
  ],
}
