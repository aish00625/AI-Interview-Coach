import axios from 'axios'
import { dropJsonHeaderForFormData } from '../utils/formDataHeaders.js'

/**
 * Single Axios instance for all backend communication.
 *
 * IMPORTANT (architecture rule from Phase 1): the React app NEVER calls
 * PostgreSQL, the Python AI service, or the code-execution service
 * directly. Every request goes through this client to the Node/Express
 * API, which is the only thing allowed to talk to those services.
 */
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' },
})

// The only place the JWT's storage key is named — AuthContext reads/writes
// the same key, so the two never drift apart.
export const TOKEN_STORAGE_KEY = 'authToken'

// Centralized auth header attachment: every request through apiClient gets
// "Authorization: Bearer <token>" automatically if a token is stored, so
// individual API functions below never touch headers themselves.
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  // File uploads (resume, audio, video) are FormData: without this the JSON default header makes Axios send the
  // form as JSON and the file never arrives. See utils/formDataHeaders.js.
  return dropJsonHeaderForFormData(config)
})

function notImplemented(name) {
  return () => {
    throw new Error(
      `${name}() has no backend yet — it will be wired up when that phase builds the corresponding Node.js endpoint.`,
    )
  }
}

/* ---------------------------------------------------------------------
 * Auth — real as of Phase 5
 * ------------------------------------------------------------------- */
export const authApi = {
  login: (credentials) => apiClient.post('/auth/login', credentials).then((res) => res.data.data),
  register: (userData) => apiClient.post('/auth/register', userData).then((res) => res.data.data),
  // Current user with role + organization, read fresh from the database (Phase A).
  me: () => apiClient.get('/auth/me').then((res) => res.data.data.user),
}

/* ---------------------------------------------------------------------
 * Admin — organization approval (Phase A). Backend enforces role=admin.
 * ------------------------------------------------------------------- */
export const adminApi = {
  listOrganizations: (status) =>
    apiClient.get('/admin/organizations', { params: status ? { status } : {} }).then((res) => res.data.data.organizations),
  approveOrganization: (id) => apiClient.post(`/admin/organizations/${id}/approve`).then((res) => res.data.data.organization),
  rejectOrganization: (id) => apiClient.post(`/admin/organizations/${id}/reject`).then((res) => res.data.data.organization),
  suspendOrganization: (id) => apiClient.post(`/admin/organizations/${id}/suspend`).then((res) => res.data.data.organization),
  // Platform-wide aggregate counts (no personal data) and live reachability of the services the app depends on.
  overview: () => apiClient.get('/admin/overview').then((res) => res.data.data), // GET /admin/overview
  serviceHealth: () => apiClient.get('/admin/service-health').then((res) => res.data.data), // GET /admin/service-health
}

/* ---------------------------------------------------------------------
 * Jobs (Phase B). Hirer endpoints are scoped to the caller's approved
 * organization on the server; candidate endpoints list open jobs only.
 * ------------------------------------------------------------------- */
export const hirerJobApi = {
  list: (params) => apiClient.get('/hirer/jobs', { params }).then((res) => res.data.data.jobs),
  get: (id) => apiClient.get(`/hirer/jobs/${id}`).then((res) => res.data.data.job),
  create: (job) => apiClient.post('/hirer/jobs', job).then((res) => res.data.data.job),
  update: (id, job) => apiClient.patch(`/hirer/jobs/${id}`, job).then((res) => res.data.data.job),
  setStatus: (id, status) => apiClient.post(`/hirer/jobs/${id}/status`, { status }).then((res) => res.data.data.job),
  remove: (id) => apiClient.delete(`/hirer/jobs/${id}`).then((res) => res.data.data),
  getAssessment: (id) => apiClient.get(`/hirer/jobs/${id}/assessment`).then((res) => res.data.data.assessment),
  setAssessment: (id, config) => apiClient.put(`/hirer/jobs/${id}/assessment`, config).then((res) => res.data.data.assessment),
  codingProblems: () => apiClient.get('/hirer/coding-problems').then((res) => res.data.data.problems),
}

export const jobApi = {
  list: (params) => apiClient.get('/jobs', { params }).then((res) => res.data.data.jobs),
  get: (id) => apiClient.get(`/jobs/${id}`).then((res) => res.data.data.job),
  // Private self-check of my skills against the job (optionally including one of my resumes). Nothing is stored or shared.
  getFit: (id, resumeId) => apiClient.get(`/jobs/${id}/fit`, { params: resumeId ? { resumeId } : {} }).then((res) => res.data.data),
}

/* ---------------------------------------------------------------------
 * Resumes & applications (Phase C) — candidate's own data only (enforced server-side).
 * ------------------------------------------------------------------- */
export const resumeApi = {
  list: () => apiClient.get('/resumes').then((res) => res.data.data.resumes),
  get: (id) => apiClient.get(`/resumes/${id}`).then((res) => res.data.data.resume),
  // Skills found in my own resume text, as suggestions to review (nothing is saved).
  suggestSkills: (id) => apiClient.get(`/resumes/${id}/skills`).then((res) => res.data.data),
  // Field name must match middleware/resumeUpload.js's upload.single('resume').
  upload: (file) => {
    const form = new FormData()
    form.append('resume', file)
    return apiClient.post('/resumes', form).then((res) => res.data.data.resume)
  },
  remove: (id) => apiClient.delete(`/resumes/${id}`).then((res) => res.data.data),
  // Authenticated download: returns a Blob (a plain <a href> could not send the Authorization header).
  download: (id) => apiClient.get(`/resumes/${id}/download`, { responseType: 'blob' }).then((res) => res.data),
}

export const applicationApi = {
  list: () => apiClient.get('/applications').then((res) => res.data.data.applications),
  get: (id) => apiClient.get(`/applications/${id}`).then((res) => res.data.data.application),
  apply: (payload) => apiClient.post('/applications', payload).then((res) => res.data.data.application),
  withdraw: (id) => apiClient.post(`/applications/${id}/withdraw`).then((res) => res.data.data.application),
  // Starts (or resumes) the job's interview assessment; returns { session, questions, resumed }.
  startInterviewAssessment: (id) => apiClient.post(`/applications/${id}/assessment/interview`).then((res) => res.data.data),
  // Grants consent to share (never revokes): { resume: true } and/or { assessment: true }.
  grantConsent: (id, grant) => apiClient.post(`/applications/${id}/consent`, grant).then((res) => res.data.data.application),
  // Which kinds of access the hiring organization has made to my data (organization only; people are not named).
  accessLog: (id) => apiClient.get(`/applications/${id}/access-log`).then((res) => res.data.data.entries),
}

/* ---------------------------------------------------------------------
 * Hirer review (Phase E). Every endpoint is scoped to the caller's approved organization on the server.
 * ------------------------------------------------------------------- */
export const hirerApplicationApi = {
  dashboard: () => apiClient.get('/hirer/dashboard').then((res) => res.data.data),
  listForJob: (jobId, params) => apiClient.get(`/hirer/jobs/${jobId}/applications`, { params }).then((res) => res.data.data),
  compare: (jobId, ids) => apiClient.get(`/hirer/jobs/${jobId}/compare`, { params: { ids: ids.join(',') } }).then((res) => res.data.data),
  get: (id) => apiClient.get(`/hirer/applications/${id}`).then((res) => res.data.data),
  setStatus: (id, status, note, reasonCode) => apiClient.post(`/hirer/applications/${id}/status`, { status, note: note || undefined, reasonCode: reasonCode || undefined }).then((res) => res.data.data),
  submitScorecard: (id, scorecard) => apiClient.post(`/hirer/applications/${id}/scorecard`, scorecard).then((res) => res.data.data.scorecards),
  addNote: (id, body) => apiClient.post(`/hirer/applications/${id}/notes`, { body }).then((res) => res.data.data.notes),
  downloadResume: (id) => apiClient.get(`/hirer/applications/${id}/resume`, { responseType: 'blob' }).then((res) => res.data),
}

/* ---------------------------------------------------------------------
 * Hiring team, audit log, notifications, account (Phase J). All authorization is server-side:
 * hiring-team routes need an approved organization and a member role with the right permission.
 * ------------------------------------------------------------------- */
export const hirerTeamApi = {
  get: () => apiClient.get('/hirer/team').then((res) => res.data.data),
  invite: (email, memberRole) => apiClient.post('/hirer/team/invitations', { email, memberRole }).then((res) => res.data.data),
  revokeInvitation: (id) => apiClient.delete(`/hirer/team/invitations/${id}`).then((res) => res.data.data),
  setRole: (userId, memberRole) => apiClient.patch(`/hirer/team/members/${userId}`, { memberRole }).then((res) => res.data.data),
  removeMember: (userId) => apiClient.delete(`/hirer/team/members/${userId}`).then((res) => res.data.data),
  auditLog: (params) => apiClient.get('/hirer/audit-log', { params }).then((res) => res.data.data.entries),
}

/* ---------------------------------------------------------------------
 * Hirer assessments (aptitude + technical MCQs + coding). Answer keys live
 * only in the question bank (owner/recruiter) and in finished attempt results.
 * ------------------------------------------------------------------- */
export const hirerAssessmentApi = {
  list: () => apiClient.get('/hirer/assessments').then((res) => res.data.data.assessments),
  get: (id) => apiClient.get(`/hirer/assessments/${id}`).then((res) => res.data.data),
  create: (body) => apiClient.post('/hirer/assessments', body).then((res) => res.data.data),
  update: (id, body) => apiClient.put(`/hirer/assessments/${id}`, body).then((res) => res.data.data),
  publish: (id) => apiClient.post(`/hirer/assessments/${id}/publish`).then((res) => res.data.data),
  close: (id) => apiClient.post(`/hirer/assessments/${id}/close`).then((res) => res.data.data),
  newVersion: (id) => apiClient.post(`/hirer/assessments/${id}/versions`).then((res) => res.data.data),
  preview: (id) => apiClient.get(`/hirer/assessments/${id}/preview`).then((res) => res.data.data),
  setReviewers: (id, userIds) => apiClient.put(`/hirer/assessments/${id}/reviewers`, { userIds }).then((res) => res.data.data.reviewers),
  candidates: (id) => apiClient.get(`/hirer/assessments/${id}/candidates`).then((res) => res.data.data),
  invite: (id, applicationIds) => apiClient.post(`/hirer/assessments/${id}/invitations`, { applicationIds }).then((res) => res.data.data),
  revokeInvitation: (id, invitationId) => apiClient.delete(`/hirer/assessments/${id}/invitations/${invitationId}`).then((res) => res.data.data),
  attempts: (id) => apiClient.get(`/hirer/assessments/${id}/attempts`).then((res) => res.data.data),
  attempt: (attemptId) => apiClient.get(`/hirer/assessments/attempts/${attemptId}`).then((res) => res.data.data),
  addNote: (attemptId, body) => apiClient.post(`/hirer/assessments/attempts/${attemptId}/notes`, { body }).then((res) => res.data.data.notes),
  setReviewStatus: (attemptId, reviewStatus) => apiClient.patch(`/hirer/assessments/attempts/${attemptId}/review-status`, { reviewStatus }).then((res) => res.data.data),
}

export const questionBankApi = {
  list: (params) => apiClient.get('/hirer/question-bank', { params }).then((res) => res.data.data),
  create: (q) => apiClient.post('/hirer/question-bank', q).then((res) => res.data.data.question),
  update: (id, q) => apiClient.put(`/hirer/question-bank/${id}`, q).then((res) => res.data.data.question),
  archive: (id, archived = true) => apiClient.post(`/hirer/question-bank/${id}/archive`, { archived }).then((res) => res.data.data.question),
}

/** Candidate side: the server decides timing, scoring and expiry; nothing here carries answer keys. */
export const candidateAssessmentApi = {
  list: () => apiClient.get('/assessments').then((res) => res.data.data.invitations),
  invitation: (id) => apiClient.get(`/assessments/invitations/${id}`).then((res) => res.data.data),
  start: (id, body) => apiClient.post(`/assessments/invitations/${id}/start`, body).then((res) => res.data.data),
  attempt: (attemptId) => apiClient.get(`/assessments/attempts/${attemptId}`).then((res) => res.data.data),
  enterSection: (attemptId, sectionId) => apiClient.post(`/assessments/attempts/${attemptId}/sections/${sectionId}/enter`).then((res) => res.data.data),
  saveAnswer: (attemptId, itemId, selectedKeys) => apiClient.put(`/assessments/attempts/${attemptId}/answers/${itemId}`, { selectedKeys }).then((res) => res.data.data),
  submitCode: (attemptId, itemId, language, sourceCode) => apiClient.post(`/assessments/attempts/${attemptId}/coding/${itemId}`, { language, sourceCode }, { timeout: 60000 }).then((res) => res.data.data),
  startMonitoring: (attemptId) => apiClient.post(`/assessments/attempts/${attemptId}/monitoring`).then((res) => res.data.data),
  reportMonitoringIssue: (attemptId, issue) => apiClient.post(`/assessments/attempts/${attemptId}/monitoring-issues`, { issue }).then((res) => res.data.data),
  submit: (attemptId) => apiClient.post(`/assessments/attempts/${attemptId}/submit`).then((res) => res.data.data),
  confirmation: (attemptId) => apiClient.get(`/assessments/attempts/${attemptId}/confirmation`).then((res) => res.data.data),
}

export const notificationApi = {
  list: (params) => apiClient.get('/notifications', { params }).then((res) => res.data.data),
  unreadCount: () => apiClient.get('/notifications/unread-count').then((res) => res.data.data.unreadCount),
  markRead: (id) => apiClient.post(`/notifications/${id}/read`).then((res) => res.data.data),
  markAllRead: () => apiClient.post('/notifications/read-all').then((res) => res.data.data),
}

export const accountApi = {
  exportData: () => apiClient.get('/account/export').then((res) => res.data.data),
  deleteAccount: (password) => apiClient.delete('/account', { data: { password, confirm: 'DELETE' } }).then((res) => res.data.data),
}

/* ---------------------------------------------------------------------
 * Profile — real as of Phase 4/5 (now requires the Authorization header)
 * ------------------------------------------------------------------- */
export const profileApi = {
  getProfile: () => apiClient.get('/users/profile').then((res) => res.data.data),
  updateProfile: (profileData) => apiClient.put('/users/profile', profileData).then((res) => res.data.data),
}

/* ---------------------------------------------------------------------
 * Interviews — real as of Phase 6; answer evaluation is the real Phase 7
 * Python NLP service, not an LLM (see backend/ai-service/README.md)
 * ------------------------------------------------------------------- */
export const interviewApi = {
  createInterview: (setup) => apiClient.post('/interviews', setup).then((res) => res.data.data), // POST /interviews
  getInterviews: (filters) => apiClient.get('/interviews', { params: filters }).then((res) => res.data.data), // GET /interviews
  getInterview: (id) => apiClient.get(`/interviews/${id}`).then((res) => res.data.data), // GET /interviews/:id
  submitInterviewAnswer: (id, answer) => apiClient.post(`/interviews/${id}/answer`, answer).then((res) => res.data.data), // POST /interviews/:id/answer
  // Field names below must match middleware/audioUpload.js's uploadAudio.single('audio')
  // and submitAudioAnswerRules' `questionId` exactly on the Node side.
  submitAudioAnswer: (sessionId, questionId, audioBlob) => {
    const form = new FormData()
    form.append('audio', audioBlob, 'answer')
    form.append('questionId', questionId)
    // No Content-Type set manually — Axios reads FormData and sets
    // "multipart/form-data; boundary=..." itself; setting it here would
    // omit the boundary and break parsing on the Node side.
    return apiClient.post(`/interviews/${sessionId}/answer/audio`, form).then((res) => res.data.data)
  },
  // Field names below must match middleware/videoUpload.js's uploadVideo.single('video')
  // and submitVideoAnswerRules' `questionId` exactly on the Node side.
  // Unlike submitAudioAnswer, this requires a text/voice answer to already
  // exist for the question (it attaches cv_metrics to that answer rather
  // than creating a new one) — see interviewService.submitVideoAnswer.
  submitVideoAnswer: (sessionId, questionId, videoBlob) => {
    const form = new FormData()
    form.append('video', videoBlob, 'answer')
    form.append('questionId', questionId)
    return apiClient.post(`/interviews/${sessionId}/answer/video`, form).then((res) => res.data.data)
  },
  skipInterviewQuestion: (id, questionId) => apiClient.post(`/interviews/${id}/skip`, { questionId }).then((res) => res.data.data), // POST /interviews/:id/skip
  getCapabilities: () => apiClient.get('/interviews/capabilities').then((res) => res.data.data), // GET /interviews/capabilities (what the AI service can do right now)
  completeInterview: (id) => apiClient.post(`/interviews/${id}/complete`).then((res) => res.data.data), // POST /interviews/:id/complete
  // This completed practice interview against my previous one of the same type and role.
  getComparison: (id) => apiClient.get(`/interviews/${id}/comparison`).then((res) => res.data.data), // GET /interviews/:id/comparison
  // Local-AI (Ollama) extras for PRACTICE interviews only. Each result says whether it came from the local model or from rule-based logic.
  requestFollowUp: (id, questionId) => apiClient.post(`/interviews/${id}/follow-ups`, { questionId }).then((res) => res.data.data), // POST /interviews/:id/follow-ups
  answerFollowUp: (id, followUpId, answerText) => apiClient.post(`/interviews/${id}/follow-ups/${followUpId}/answer`, { answerText }).then((res) => res.data.data), // POST /interviews/:id/follow-ups/:followUpId/answer
  skipFollowUp: (id, followUpId) => apiClient.post(`/interviews/${id}/follow-ups/${followUpId}/skip`).then((res) => res.data.data), // POST /interviews/:id/follow-ups/:followUpId/skip
  getStar: (id, questionId) => apiClient.get(`/interviews/${id}/questions/${questionId}/star`).then((res) => res.data.data), // GET /interviews/:id/questions/:questionId/star
  generateStar: (id, questionId) => apiClient.post(`/interviews/${id}/questions/${questionId}/star`).then((res) => res.data.data), // POST /interviews/:id/questions/:questionId/star
  getAiReport: (id) => apiClient.get(`/interviews/${id}/ai-report`).then((res) => res.data.data), // GET /interviews/:id/ai-report
  generateAiReport: (id) => apiClient.post(`/interviews/${id}/ai-report`).then((res) => res.data.data), // POST /interviews/:id/ai-report
}

/* ---------------------------------------------------------------------
 * Face behaviour monitoring — optional, consent-based, practice only. Frames are small JPEGs sent one at a time to the Node API
 * (multipart field "frame", matching middleware/faceFrameUpload.js); the server analyses them in memory and keeps no images.
 * ------------------------------------------------------------------- */
const frameForm = (blob) => { const form = new FormData(); form.append('frame', blob, 'frame.jpg'); return form }
export const faceMonitorApi = {
  getCapabilities: () => apiClient.get('/face-monitoring/capabilities').then((res) => res.data.data),
  listSessions: () => apiClient.get('/face-monitoring/sessions').then((res) => res.data.data),
  createSession: (body) => apiClient.post('/face-monitoring/sessions', body).then((res) => res.data.data),
  getSession: (id) => apiClient.get(`/face-monitoring/sessions/${id}`).then((res) => res.data.data),
  getReport: (id) => apiClient.get(`/face-monitoring/sessions/${id}/report`).then((res) => res.data.data),
  submitFrame: (id, blob) => apiClient.post(`/face-monitoring/sessions/${id}/frames`, frameForm(blob), { timeout: 15000 }).then((res) => res.data.data),
  captureReference: (id, blob) => apiClient.post(`/face-monitoring/sessions/${id}/reference`, frameForm(blob), { timeout: 15000 }).then((res) => res.data.data),
  reportCameraStatus: (id, status) => apiClient.post(`/face-monitoring/sessions/${id}/camera-status`, { status }).then((res) => res.data.data),
  pause: (id) => apiClient.post(`/face-monitoring/sessions/${id}/pause`).then((res) => res.data.data),
  resume: (id) => apiClient.post(`/face-monitoring/sessions/${id}/resume`).then((res) => res.data.data),
  end: (id) => apiClient.post(`/face-monitoring/sessions/${id}/end`).then((res) => res.data.data),
  remove: (id) => apiClient.delete(`/face-monitoring/sessions/${id}`).then((res) => res.data.data),
}

/* ---------------------------------------------------------------------
 * Coding — problem browsing is real as of Phase 8. createSubmission is
 * real as of Phase 9: it now actually executes the code (inside an
 * isolated Docker container via the code-executor service) and returns
 * the real result — it does not just save a "pending" row anymore.
 * runCode/submitCode (the separate run-without-submitting concept) stay
 * unimplemented.
 * ------------------------------------------------------------------- */
export const codingApi = {
  getCodingProblems: (filters) => apiClient.get('/coding/problems', { params: filters }).then((res) => res.data.data), // GET /coding/problems
  getCodingProblem: (id) => apiClient.get(`/coding/problems/${id}`).then((res) => res.data.data), // GET /coding/problems/:id
  createSubmission: (submission) => apiClient.post('/coding/submissions', submission).then((res) => res.data.data), // POST /coding/submissions
  getSubmission: (id) => apiClient.get(`/coding/submissions/${id}`).then((res) => res.data.data), // GET /coding/submissions/:id
  getMySubmissions: () => apiClient.get('/coding/submissions').then((res) => res.data.data), // GET /coding/submissions
  // Solved / attempted flag per problem for my practice (no code, no tests): drives the badges on the problem list.
  getProgress: () => apiClient.get('/coding/progress').then((res) => res.data.data.progress), // GET /coding/progress
  runCode: (payload) => apiClient.post('/coding/run', payload).then((res) => res.data.data), // POST /coding/run — sample tests only, nothing recorded
  // Runs the SAMPLE tests in the Docker executor (the authority on pass/fail) and adds advisory coaching from the local model.
  coach: (payload) => apiClient.post('/coding/coach', payload).then((res) => res.data.data), // POST /coding/coach
  getHints: (problemId) => apiClient.get(`/coding/problems/${problemId}/hints`).then((res) => res.data.data), // GET /coding/problems/:id/hints
  revealNextHint: (problemId) => apiClient.post(`/coding/problems/${problemId}/hints/next`).then((res) => res.data.data), // POST /coding/problems/:id/hints/next
  submitCode: notImplemented('codingApi.submitCode'), // POST /coding/submit — Phase 9
}

/* ---------------------------------------------------------------------
 * Topics — public lookup list, used to populate the coding-problems topic filter
 * ------------------------------------------------------------------- */
export const topicApi = {
  getTopics: () => apiClient.get('/topics').then((res) => res.data.data), // GET /topics
}

/* ---------------------------------------------------------------------
 * Dashboard / performance — real as of Phase 12
 * ------------------------------------------------------------------- */
export const dashboardApi = {
  getPerformance: () => apiClient.get('/performance').then((res) => res.data.data), // GET /performance
  // Readiness, knowledge-gap map, review queue, streak, heatmap, goals and next steps - all from my own practice records.
  getPreparation: () => apiClient.get('/dashboard/preparation').then((res) => res.data.data), // GET /dashboard/preparation
  // Weekly goals I choose (whole numbers; 0 = no goal for that item).
  // Today's practice plan, built from my own progress (rule-based; never invents statistics).
  getPlan: () => apiClient.get('/dashboard/plan').then((res) => res.data.data), // GET /dashboard/plan
  // Is the local AI model (Ollama) ready? Never throws on the server side; reports a state instead.
  getAiStatus: () => apiClient.get('/dashboard/ai-status').then((res) => res.data.data), // GET /dashboard/ai-status
  setGoals: (goals) => apiClient.put('/dashboard/goals', goals).then((res) => res.data.data.goals), // PUT /dashboard/goals
}

export default apiClient
