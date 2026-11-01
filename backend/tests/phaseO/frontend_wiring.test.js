// Source-level checks for the local-AI screens. The React build/render has NOT been run in the authoring sandbox.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const src = (p) => fs.readFileSync(path.join(__dirname, '../../../frontend/src', p), 'utf8')

test('every local-AI API call points at a real backend route', () => {
  const api = src('services/api.js')
  const routes = fs.readFileSync(path.join(__dirname, '../../routes/interviewRoutes.js'), 'utf8')
  for (const frag of ['/follow-ups', '/answer', '/skip', '/star', '/ai-report']) assert.ok(api.includes(frag) && routes.includes(frag), frag)
  assert.match(api, /'\/coding\/coach'/); assert.match(fs.readFileSync(path.join(__dirname, '../../routes/codingRoutes.js'), 'utf8'), /'\/coach'/)
  assert.match(api, /'\/dashboard\/plan'/); assert.match(api, /'\/dashboard\/ai-status'/)
})
test('live interview shows follow-ups only for practice sessions', () => {
  const s = src('pages/LiveInterview.jsx')
  assert.match(s, /Array\.isArray\(detail\.followUps\)/); assert.match(s, /answered && isPractice/); assert.match(s, /<FollowUpPanel key=/)
})
test('follow-up panel: skip, retry, loading, source label, and says it never changes scores', () => {
  const s = src('components/FollowUpPanel.jsx')
  for (const k of ['skipFollowUp', 'answerFollowUp', 'requestFollowUp', 'Skip this follow-up', 'Try again', 'LoadingSpinner', 'AiSourceBadge', 'never changes your scores']) assert.ok(s.includes(k), k)
})
test('results page: report for practice sessions, STAR only for behavioural questions in practice interviews, follow-up turns listed', () => {
  const s = src('pages/InterviewResults.jsx')
  assert.match(s, /followUps && <div[^>]*><AiReportPanel/); assert.match(s, /followUps && shouldOfferStar\(session\.interview_type, q\.question_text\) && <Card><StarCoachPanel/); assert.match(s, /Follow-up conversation/)
})
test('STAR panel quotes evidence, labels advisory output and offers retry', () => {
  const s = src('components/StarCoachPanel.jsx')
  for (const k of ['generateStar', 'getStar', 'evidence', 'Advisory', 'AiSourceBadge', 'Re-run analysis']) assert.ok(s.includes(k), k)
})
test('coding coach is hidden in assessments, keeps the executor result separate and labels AI notes advisory', () => {
  assert.match(src('pages/CodingEnvironment.jsx'), /!applicationId && <CodeCoachPanel/)
  const s = src('components/CodeCoachPanel.jsx')
  assert.match(s, /from running your code/); assert.match(s, /advisory/); assert.match(s, /<RunResults result=\{out\.run\}/)
  assert.equal(/\bpassed\b.*coaching|coaching\.passed/.test(s), false)
})
test('dashboard shows the daily plan with reasons and an AI status badge that never blocks the page', () => {
  assert.match(src('pages/Dashboard.jsx'), /<DailyPlanPanel \/>/)
  const p = src('components/DailyPlanPanel.jsx'); assert.match(p, /getPlan/); assert.match(p, /t\.reason/); assert.match(p, /Try again/)
  const b = src('components/AiStatusBadge.jsx'); assert.match(b, /getAiStatus/); assert.match(b, /Check again/)
})
test('error messages exist for every model failure reason', () => {
  const s = src('utils/aiErrors.js')
  for (const r of ['llm_disabled', 'llm_unreachable', 'llm_model_missing', 'llm_timeout', 'llm_busy', 'llm_bad_response']) assert.ok(s.includes(r), r)
})

test('results page shows the combined content + delivery summary and per-signal delivery bars', () => {
  assert.match(src('pages/InterviewResults.jsx'), /detail\.combinedSummary/); assert.match(src('pages/InterviewResults.jsx'), /<CombinedSummary summary=\{combined\}/)
  const p = src('components/DeliveryPanel.jsx'); assert.match(p, /export function CombinedSummary/); assert.match(p, /never shown to employers|Rule-based/)
})

test('results page shows the combined content + delivery summary and per-signal delivery bars', () => {
  assert.match(src('pages/InterviewResults.jsx'), /detail\.combinedSummary/); assert.match(src('pages/InterviewResults.jsx'), /<CombinedSummary summary=\{combined\}/)
  const p = src('components/DeliveryPanel.jsx'); assert.match(p, /export function CombinedSummary/); assert.match(p, /Rule-based/)
})
test('camera is asked about once, before the first question, and never starts without a Yes', () => {
  const s = src('pages/LiveInterview.jsx')
  assert.match(s, /cameraChoice === 'unset'/); assert.match(s, /Use your camera for delivery feedback\?/); assert.match(s, /Yes, use my camera/); assert.match(s, /No thanks, continue without/)
  assert.match(s, /function chooseCamera\(yes\)/)
  // getUserMedia for the text-mode camera happens only inside chooseCamera (the click handler), not in an effect
  const idx = s.indexOf("getUserMedia({ video: true })"); assert.ok(idx > s.indexOf('function chooseCamera') && idx < s.indexOf('function startTextRecorder'))
  assert.equal(s.includes('Enable Camera'), false, 'the old after-answer camera button is gone')
  assert.match(s, /handleSubmitVideoAnswer\(clip, result\)/)
})

test('code editor is adjustable: drag-resizable height, wide toggle, font size, remembered safely', () => {
  const s = src('pages/CodingEnvironment.jsx')
  assert.match(s, /resize: 'vertical'/); assert.match(s, /Wide editor/); assert.match(s, /aria-label="Larger text"/); assert.match(s, /try \{ localStorage/)
  assert.match(src('components/CodeEditor.jsx'), /fontSize,/)
})

test('score breakdown panel is wired into practice results only and labels unavailable / experimental signals', () => {
  const r = src('pages/InterviewResults.jsx')
  assert.match(r, /ScoreBreakdown/); assert.match(r, /!session\.application_id && <ScoreBreakdown/)
  const s = src('components/ScoreBreakdown.jsx')
  assert.match(s, /Experimental/); assert.match(s, /Unavailable/); assert.match(s, /completed before behaviour scoring/); assert.match(s, /never part of the score/)
})
