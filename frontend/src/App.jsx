import { lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import PublicLayout from './layouts/PublicLayout.jsx'
import DashboardLayout from './layouts/DashboardLayout.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import RoleRoute from './components/RoleRoute.jsx'

// Landing / Login / Register stay eager: they are the first screen for logged-out
// visitors. Every other page is code-split and loaded on first navigation; the
// Suspense boundary lives in DashboardLayout so the sidebar stays mounted.
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const InterviewSetup = lazy(() => import('./pages/InterviewSetup.jsx'))
const LiveInterview = lazy(() => import('./pages/LiveInterview.jsx'))
const InterviewResults = lazy(() => import('./pages/InterviewResults.jsx'))
const CodingProblems = lazy(() => import('./pages/CodingProblems.jsx'))
const CodingEnvironment = lazy(() => import('./pages/CodingEnvironment.jsx'))
const ProgressDashboard = lazy(() => import('./pages/ProgressDashboard.jsx'))
const InterviewHistory = lazy(() => import('./pages/InterviewHistory.jsx'))
const HirerDashboard = lazy(() => import('./pages/HirerDashboard.jsx'))
const HirerJobs = lazy(() => import('./pages/HirerJobs.jsx'))
const HirerJobForm = lazy(() => import('./pages/HirerJobForm.jsx'))
const HirerJobAssessment = lazy(() => import('./pages/HirerJobAssessment.jsx'))
const HirerApplicants = lazy(() => import('./pages/HirerApplicants.jsx'))
const HirerApplicationReview = lazy(() => import('./pages/HirerApplicationReview.jsx'))
const HirerCompare = lazy(() => import('./pages/HirerCompare.jsx'))
const JobBoard = lazy(() => import('./pages/JobBoard.jsx'))
const JobDetail = lazy(() => import('./pages/JobDetail.jsx'))
const MyResumes = lazy(() => import('./pages/MyResumes.jsx'))
const MyApplications = lazy(() => import('./pages/MyApplications.jsx'))
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail.jsx'))
const AdminOrganizations = lazy(() => import('./pages/AdminOrganizations.jsx'))
const AdminOverview = lazy(() => import('./pages/AdminOverview.jsx'))
const HirerTeam = lazy(() => import('./pages/HirerTeam.jsx'))
const HirerAuditLog = lazy(() => import('./pages/HirerAuditLog.jsx'))
const Notifications = lazy(() => import('./pages/Notifications.jsx'))
const Account = lazy(() => import('./pages/Account.jsx'))
const FaceMonitoring = lazy(() => import('./pages/FaceMonitoring.jsx'))
const HirerAssessments = lazy(() => import('./pages/HirerAssessments.jsx'))
const HirerAssessmentBuilder = lazy(() => import('./pages/HirerAssessmentBuilder.jsx'))
const HirerAssessmentPreview = lazy(() => import('./pages/HirerAssessmentPreview.jsx'))
const HirerAssessmentCandidates = lazy(() => import('./pages/HirerAssessmentCandidates.jsx'))
const HirerAttemptReview = lazy(() => import('./pages/HirerAttemptReview.jsx'))
const HirerQuestionBank = lazy(() => import('./pages/HirerQuestionBank.jsx'))
const MyAssessments = lazy(() => import('./pages/MyAssessments.jsx'))
const TakeAssessment = lazy(() => import('./pages/TakeAssessment.jsx'))

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Protected routes — wrapped in ProtectedRoute, which will enforce
          real auth once Phase 5 wires up the JWT-backed AuthContext. */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          {/* Candidate portal — unchanged paths, now gated to the candidate role */}
          <Route element={<RoleRoute allow={['candidate']} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/interview/setup" element={<InterviewSetup />} />
            <Route path="/interview/:id" element={<LiveInterview />} />
            <Route path="/interview/:id/results" element={<InterviewResults />} />
            <Route path="/coding" element={<CodingProblems />} />
            <Route path="/coding/:id" element={<CodingEnvironment />} />
            <Route path="/progress" element={<ProgressDashboard />} />
            <Route path="/history" element={<InterviewHistory />} />
            <Route path="/jobs" element={<JobBoard />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/resumes" element={<MyResumes />} />
            <Route path="/applications" element={<MyApplications />} />
            <Route path="/applications/:id" element={<ApplicationDetail />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/face-monitoring" element={<FaceMonitoring />} />
            <Route path="/assessments" element={<MyAssessments />} />
            <Route path="/assessments/:invitationId" element={<TakeAssessment />} />
          </Route>

          {/* Hirer portal (Phase A: status page; jobs/applicants in later phases) */}
          <Route element={<RoleRoute allow={['hirer']} />}>
            <Route path="/hirer/dashboard" element={<HirerDashboard />} />
            <Route path="/hirer/jobs" element={<HirerJobs />} />
            <Route path="/hirer/jobs/new" element={<HirerJobForm />} />
            <Route path="/hirer/jobs/:id/edit" element={<HirerJobForm />} />
            <Route path="/hirer/jobs/:id/assessment" element={<HirerJobAssessment />} />
            <Route path="/hirer/jobs/:id/applicants" element={<HirerApplicants />} />
            <Route path="/hirer/jobs/:id/compare" element={<HirerCompare />} />
            <Route path="/hirer/applications/:id" element={<HirerApplicationReview />} />
            <Route path="/hirer/team" element={<HirerTeam />} />
            <Route path="/hirer/audit-log" element={<HirerAuditLog />} />
            <Route path="/hirer/assessments" element={<HirerAssessments />} />
            <Route path="/hirer/assessments/new" element={<HirerAssessmentBuilder />} />
            <Route path="/hirer/assessments/:id" element={<HirerAssessmentBuilder />} />
            <Route path="/hirer/assessments/:id/preview" element={<HirerAssessmentPreview />} />
            <Route path="/hirer/assessments/:id/candidates" element={<HirerAssessmentCandidates />} />
            <Route path="/hirer/assessment-attempts/:attemptId" element={<HirerAttemptReview />} />
            <Route path="/hirer/question-bank" element={<HirerQuestionBank />} />
          </Route>

          {/* Export / delete my data: candidates and hiring members (the server refuses administrators) */}
          <Route element={<RoleRoute allow={['candidate', 'hirer']} />}>
            <Route path="/account" element={<Account />} />
          </Route>

          {/* Admin: platform overview and organization approval */}
          <Route element={<RoleRoute allow={['admin']} />}>
            <Route path="/admin/overview" element={<AdminOverview />} />
            <Route path="/admin/organizations" element={<AdminOrganizations />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
