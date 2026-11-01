const { param, query, body } = require('express-validator')

/**
 * Reusable express-validator chains. Each route composes the ones it
 * needs, then `handleValidationErrors` (validate.js) turns any failure
 * into a clean 400 response.
 */

const idParam = (name = 'id') => param(name).isInt({ min: 1, max: 9007199254740991 }).withMessage(`${name} must be a positive integer`)

const difficultyQuery = query('difficulty')
  .optional()
  .isIn(['easy', 'medium', 'hard']).withMessage('difficulty must be easy, medium, or hard')

const topicQuery = query('topic').optional().isString().trim().notEmpty()

const searchQuery = query('search').optional().isString().trim().isLength({ max: 100 })

const profileUpdateRules = [
  body('targetRole').optional().isString().trim().isLength({ max: 100 }),
  body('experienceLevel').optional().isIn(['fresher', 'experienced']),
  body('preferredLanguage').optional().isIn(['cpp', 'java', 'python', 'javascript']),
  body('skillNames').optional().isArray().withMessage('skillNames must be an array of strings'),
  body('skillNames.*').optional().isString().trim().notEmpty(),
]

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required.'),
  body('email').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  // Optional so existing candidate registration payloads keep working unchanged.
  body('role').optional().isIn(['candidate', 'hirer']).withMessage('Account type must be candidate or hirer.'),
  body('inviteToken').optional({ nullable: true }).isString().isLength({ min: 64, max: 64 }).withMessage('The invitation code is not valid.'),
  body('companyName')
    .if((value, { req }) => req.body.role === 'hirer' && !req.body.inviteToken)
    .trim().notEmpty().withMessage('Company name is required for hiring accounts.')
    .isLength({ max: 150 }).withMessage('Company name must be 150 characters or fewer.'),
]

const loginRules = [
  body('email').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
]

const createInterviewRules = [
  body('interviewType').isIn(['technical', 'behavioral', 'hr', 'mixed']).withMessage('interviewType must be technical, behavioral, hr, or mixed.'),
  body('targetRole').trim().notEmpty().withMessage('targetRole is required.').isLength({ max: 100 }),
  body('difficulty').isIn(['easy', 'medium', 'hard']).withMessage('difficulty must be easy, medium, or hard.'),
  // Accepted so the frontend can send its own UI state, but there is no
  // matching column in interview_sessions — the controller doesn't persist it.
  body('answerMode').optional().isIn(['text', 'voice']),
  // Opt-in practice options (Phase I). Strict booleans: anything else is ignored by the controller.
  body('personalize').optional().isBoolean().withMessage('personalize must be true or false.'),
  body('adaptive').optional().isBoolean().withMessage('adaptive must be true or false.'),
]

const skipQuestionRules = [
  body('questionId').isInt({ min: 1, max: 9007199254740991 }).withMessage('questionId must be a positive integer.'),
]

const submitAnswerRules = [
  body('questionId').isInt({ min: 1, max: 9007199254740991 }).withMessage('questionId must be a positive integer.'),
  body('answerText').trim().notEmpty().withMessage('Answer cannot be empty.').isLength({ max: 5000 }).withMessage('Answer is too long (max 5000 characters).'),
  // Optional typing counters (practice only; sanitised and re-derived server-side in utils/typingMetrics.js).
  body('typingMetrics').optional({ nullable: true }).custom((v) => {
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error('typingMetrics must be an object.')
    if (JSON.stringify(v).length > 2000) throw new Error('typingMetrics is too large.')
    return true
  }),
]

// Multipart form field (a string, same as any other multipart field) —
// the audio file itself is validated separately by middleware/audioUpload.js.
const submitAudioAnswerRules = [
  body('questionId').isInt({ min: 1, max: 9007199254740991 }).withMessage('questionId must be a positive integer.'),
]

// Same shape as submitAudioAnswerRules — the video file itself is
// validated separately by middleware/videoUpload.js.
const submitVideoAnswerRules = [
  body('questionId').isInt({ min: 1, max: 9007199254740991 }).withMessage('questionId must be a positive integer.'),
]


// Face monitoring: the client may only say "I agree", optionally which practice interview it relates to, and enumerated
// camera statuses. Scores, severities, timings and results are never accepted from the client.
const faceSessionRules = [
  body('consent').isBoolean({ strict: true }).withMessage('consent must be true or false.'),
  body('identityConsent').optional().isBoolean({ strict: true }).withMessage('identityConsent must be true or false.'),
  body('interviewSessionId').optional({ nullable: true }).isInt({ min: 1, max: 9007199254740991 }).withMessage('interviewSessionId must be a positive integer.'),
]
const faceCameraStatusRules = [
  body('status').isIn(['permission_denied', 'device_not_found', 'device_in_use', 'track_ended', 'stream_error', 'preview_stalled', 'capture_failed']).withMessage('Unknown camera status.'),
]

// language is intentionally an allowlist (matches coding_submissions' CHECK
// constraint exactly) — never accept an arbitrary language string.
const createSubmissionRules = [
  body('problemId').isInt({ min: 1, max: 9007199254740991 }).withMessage('problemId must be a positive integer.'),
  body('language').isIn(['cpp', 'java', 'python', 'javascript']).withMessage('language must be cpp, java, python, or javascript.'),
  body('sourceCode').trim().notEmpty().withMessage('sourceCode cannot be empty.').isLength({ max: 20000 }).withMessage('sourceCode is too long (max 20000 characters).'),
  body('sessionId').optional().isInt({ min: 1, max: 9007199254740991 }).withMessage('sessionId must be a positive integer.'),
  body('applicationId').optional().isInt({ min: 1, max: 9007199254740991 }).withMessage('applicationId must be a positive integer.'),
]

const jobFitQuery = [query('resumeId').optional().isInt({ min: 1, max: 9007199254740991 }).withMessage('resumeId must be a positive integer.')]

// Run Code (Phase I): executes against the problem's visible sample tests only; nothing is saved.
const runCodeRules = [
  body('problemId').isInt({ min: 1, max: 9007199254740991 }).withMessage('problemId must be a positive integer.'),
  body('language').isIn(['cpp', 'java', 'python', 'javascript']).withMessage('language must be cpp, java, python, or javascript.'),
  body('sourceCode').trim().notEmpty().withMessage('sourceCode cannot be empty.').isLength({ max: 20000 }).withMessage('sourceCode is too long (max 20000 characters).'),
]

const intParam = (name) => param(name).isInt({ min: 1, max: 9007199254740991 }).withMessage(`${name} must be a positive integer.`)
const followUpRequestRules = [body('questionId').isInt({ min: 1, max: 9007199254740991 }).withMessage('questionId must be a positive integer.')]
const followUpAnswerRules = [
  intParam('followUpId'),
  body('answerText').isString().withMessage('answerText must be text.').trim().notEmpty().withMessage('Answer cannot be empty.').isLength({ max: 4000 }).withMessage('Answer is too long (max 4000 characters).'),
]

const jobBodyRules = (required) => {
  const opt = (chain) => (required ? chain : chain.optional())
  return [
    opt(body('title')).isString().trim().notEmpty().withMessage('Job title is required.').isLength({ max: 150 }).withMessage('Job title must be 150 characters or fewer.'),
    opt(body('description')).isString().trim().notEmpty().withMessage('Job description is required.').isLength({ max: 10000 }).withMessage('Job description is too long (max 10000 characters).'),
    body('location').optional({ nullable: true }).isString().trim().isLength({ max: 150 }).withMessage('Location must be 150 characters or fewer.'),
    body('employmentType').optional().isIn(['full_time', 'part_time', 'internship', 'contract']).withMessage('employmentType must be full_time, part_time, internship, or contract.'),
    body('experienceLevel').optional().isIn(['fresher', 'experienced', 'any']).withMessage('experienceLevel must be fresher, experienced, or any.'),
    body('eligibilityCriteria').optional({ nullable: true }).isString().trim().isLength({ max: 5000 }).withMessage('Eligibility criteria is too long (max 5000 characters).'),
    body('closesAt').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('closesAt must be a valid date.'),
    body('blindReview').optional().isBoolean().withMessage('blindReview must be true or false.'),
    body('scorecardCriteria').optional({ nullable: true }).isArray({ max: 8 }).withMessage('scorecardCriteria must be a list of at most 8 criteria.'),
    body('requiredSkills').optional().isArray({ max: 20 }).withMessage('requiredSkills must be an array of at most 20 skills.'),
    body('requiredSkills.*').optional().custom((v) => typeof v === 'string' || (v && typeof v === 'object' && typeof v.name === 'string'))
      .withMessage('Each required skill must be a name or { name, mandatory }.'),
  ]
}
const createJobRules = jobBodyRules(true)
const updateJobRules = jobBodyRules(false)
const jobStatusRules = [body('status').isIn(['open', 'closed']).withMessage('status must be open or closed.')]
const jobListQuery = [
  query('status').optional().isIn(['draft', 'open', 'closed']).withMessage('status must be draft, open, or closed.'),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  query('page').optional().isInt({ min: 1, max: 10000 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
]

const applyRules = [
  body('jobId').isInt({ min: 1, max: 9007199254740991 }).withMessage('jobId must be a positive integer.'),
  body('resumeId').isInt({ min: 1, max: 9007199254740991 }).withMessage('Choose a resume to apply with.'),
  body('coverNote').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }).withMessage('Cover note is too long (max 2000 characters).'),
  body('consentShareResume').equals('true').withMessage('To apply you must agree to share your resume and profile with the hiring team.'),
  body('consentShareAssessment').optional().isBoolean().withMessage('consentShareAssessment must be true or false.'),
]
const consentRules = [
  body('resume').optional().isBoolean().withMessage('resume must be true or false.'),
  body('assessment').optional().isBoolean().withMessage('assessment must be true or false.'),
]

const assessmentConfigRules = [
  body('interviewEnabled').isBoolean().withMessage('interviewEnabled must be true or false.'),
  body('interviewType').optional().isIn(['technical', 'behavioral', 'hr', 'mixed']).withMessage('interviewType must be technical, behavioral, hr, or mixed.'),
  body('interviewDifficulty').optional().isIn(['easy', 'medium', 'hard']).withMessage('interviewDifficulty must be easy, medium, or hard.'),
  body('problemIds').isArray({ max: 5 }).withMessage('problemIds must be an array of at most 5 problem ids.'),
  body('problemIds.*').isInt({ min: 1, max: 9007199254740991 }).withMessage('problemIds must be positive integers.'),
]

const applicantListQuery = [
  query('status').optional().isIn(['submitted', 'under_review', 'shortlisted', 'rejected', 'hired', 'withdrawn']).withMessage('Invalid status filter.'),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  query('sort').optional().isIn(['newest', 'oldest', 'match', 'interview']).withMessage('Invalid sort option.'),
]
const compareQuery = [
  query('ids').isString().matches(/^\d+(,\d+){1,4}$/).withMessage('ids must be 2 to 5 comma-separated application ids.'),
]
const applicationStatusRules = [
  body('status').isIn(['under_review', 'shortlisted', 'rejected', 'hired']).withMessage('status must be under_review, shortlisted, rejected, or hired.'),
  body('reasonCode').optional({ nullable: true }).isString().isLength({ max: 40 }).withMessage('reasonCode is not valid.'),
  body('note').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }).withMessage('Note is too long (max 1000 characters).'),
]
const applicationNoteRules = [
  body('body').isString().trim().notEmpty().withMessage('Note cannot be empty.').isLength({ max: 4000 }).withMessage('Note is too long (max 4000 characters).'),
]

const scorecardRules = [
  body('recommendation').isIn(['strong_yes', 'yes', 'no', 'strong_no']).withMessage('Choose a recommendation: strong yes, yes, no or strong no.'),
  body('summary').optional({ nullable: true }).isString().isLength({ max: 2000 }).withMessage('The summary must be 2000 characters or fewer.'),
  body('ratings').isArray({ min: 1, max: 8 }).withMessage('ratings must be a list.'),
  body('ratings.*.key').isString().isLength({ min: 1, max: 40 }),
  body('ratings.*.rating').isInt({ min: 1, max: 5 }).withMessage('Ratings must be whole numbers from 1 to 5.'),
  body('ratings.*.comment').optional({ nullable: true }).isString().isLength({ max: 1000 }),
]
const inviteRules = [
  body('email').isEmail().withMessage('Enter a valid e-mail address.'),
  body('memberRole').isIn(['recruiter', 'reviewer']).withMessage('Role must be recruiter or reviewer.'),
]
const memberRoleRules = [body('memberRole').isIn(['owner', 'recruiter', 'reviewer']).withMessage('Role must be owner, recruiter or reviewer.')]
const auditQuery = [
  query('applicationId').optional().isInt({ min: 1, max: 9007199254740991 }),
  query('before').optional().isInt({ min: 1, max: 9007199254740991 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
]
const notificationQuery = [
  query('unread').optional().isBoolean(),
  query('before').optional().isInt({ min: 1, max: 9007199254740991 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
]
const deleteAccountRules = [
  body('password').isString().notEmpty().withMessage('Enter your password to confirm.'),
  body('confirm').equals('DELETE').withMessage('Type DELETE to confirm.'),
]

const goalsRules = [
  body('weeklyInterviews').isInt({ min: 0, max: 50 }).withMessage('weeklyInterviews must be a whole number from 0 to 50').toInt(),
  body('weeklyProblems').isInt({ min: 0, max: 200 }).withMessage('weeklyProblems must be a whole number from 0 to 200').toInt(),
]

/* Hirer assessments (migration 018). Structure is checked here; the services re-check everything against the database. */
const ID = { min: 1, max: 9007199254740991 }
const assessmentDefinitionRules = [
  body('jobId').isInt(ID).withMessage('Choose the job this assessment is for.'),
  body('title').isString().trim().isLength({ min: 3, max: 200 }).withMessage('The title must be 3-200 characters.'),
  body('description').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('instructions').optional({ nullable: true }).isString().isLength({ max: 8000 }),
  body('durationMinutes').isInt({ min: 5, max: 600 }).withMessage('Duration must be 5-600 minutes.'),
  body('maxAttempts').optional().isInt({ min: 1, max: 5 }).withMessage('Maximum attempts must be 1 to 5.'),
  body('passPercent').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }).withMessage('The pass mark must be 0-100.'),
  body('availableFrom').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('availableFrom must be a date and time.'),
  body('availableUntil').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('availableUntil must be a date and time.'),
  body('monitoringEnabled').optional().isBoolean(),
  body('sections').optional().isArray({ max: 3 }).withMessage('At most three sections.'),
  body('sections.*.kind').isIn(['aptitude', 'technical', 'coding']).withMessage('Section kind must be aptitude, technical or coding.'),
  body('sections.*.items').optional().isArray({ max: 100 }),
]
const assessmentReviewersRules = [body('userIds').isArray({ max: 50 }).withMessage('userIds must be a list.'), body('userIds.*').isInt(ID)]
const assessmentInviteRules = [body('applicationIds').isArray({ min: 1, max: 200 }).withMessage('Choose 1-200 applicants.'), body('applicationIds.*').isInt(ID)]
const assessmentReviewStatusRules = [body('reviewStatus').isIn(['pending', 'in_review', 'reviewed']).withMessage('Review status must be pending, in_review or reviewed.')]
const questionRules = [
  body('sectionKind').isIn(['aptitude', 'technical']).withMessage('sectionKind must be aptitude or technical.'),
  body('category').isString().isLength({ min: 1, max: 40 }),
  body('questionType').optional().isIn(['single', 'multiple']),
  body('questionText').isString().trim().isLength({ min: 5, max: 4000 }).withMessage('The question must be 5-4000 characters.'),
  body('choices').isArray({ min: 4, max: 8 }).withMessage('Give 4 to 8 choices.'),
  body('correctKeys').isArray({ min: 1, max: 8 }).withMessage('Mark at least one correct choice.'),
  body('correctKeys.*').isString().isLength({ min: 1, max: 1 }),
  body('explanation').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('difficulty').optional().isIn(['easy', 'medium', 'hard']),
  body('marks').optional().isFloat({ gt: 0, max: 100 }),
]
const questionListQuery = [query('sectionKind').optional().isIn(['aptitude', 'technical']), query('category').optional().isString().isLength({ max: 40 }), query('includeArchived').optional().isIn(['true', 'false'])]
const startAttemptRules = [
  body('acceptTerms').isBoolean().withMessage('acceptTerms must be true or false.'),
  body('monitoring').optional({ nullable: true }).isIn(['camera', 'alternative']).withMessage('monitoring must be camera or alternative.'),
  body('accommodationNote').optional({ nullable: true }).isString().isLength({ max: 1000 }),
]
const saveAnswerRules = [body('selectedKeys').isArray({ max: 8 }).withMessage('selectedKeys must be a list.'), body('selectedKeys.*').isString().isLength({ min: 1, max: 1 })]
const assessmentCodeRules = [
  body('language').isIn(['cpp', 'java', 'python', 'javascript']).withMessage('language must be cpp, java, python, or javascript.'),
  body('sourceCode').isString().trim().notEmpty().withMessage('sourceCode cannot be empty.').isLength({ max: 20000 }).withMessage('sourceCode is too long (max 20000 characters).'),
]
const monitoringIssueRules = [body('issue').isIn(['camera_denied', 'camera_unavailable', 'camera_lost', 'service_unavailable', 'other_session_running']).withMessage('Unknown monitoring issue.')]

module.exports = {
  assessmentDefinitionRules, assessmentReviewersRules, assessmentInviteRules, assessmentReviewStatusRules, questionRules, questionListQuery,
  startAttemptRules, saveAnswerRules, assessmentCodeRules, monitoringIssueRules,
  goalsRules,
  scorecardRules, inviteRules, memberRoleRules, auditQuery, notificationQuery, deleteAccountRules, consentRules,
  applicantListQuery, compareQuery, applicationStatusRules, applicationNoteRules,
  assessmentConfigRules,
  applyRules,
  createJobRules, updateJobRules, jobStatusRules, jobListQuery,
  idParam, difficultyQuery, topicQuery, searchQuery, profileUpdateRules, registerRules, loginRules,
  faceSessionRules, faceCameraStatusRules,
  intParam, followUpRequestRules, followUpAnswerRules, createInterviewRules, submitAnswerRules, skipQuestionRules, submitAudioAnswerRules, submitVideoAnswerRules, createSubmissionRules, runCodeRules, jobFitQuery,
}
