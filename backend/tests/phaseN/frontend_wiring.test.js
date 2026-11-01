// Static (source-level) checks that the Phase N screens call the endpoints they depend on and are routed. The React build
// itself has NOT been run in the authoring environment (no npm registry access), so this guards against the failure mode
// "a page renders but never calls the server / is not reachable", not against runtime rendering bugs.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const src = (p) => fs.readFileSync(path.join(__dirname, '../../../frontend/src', p), 'utf8')

test('candidate dashboard loads the preparation endpoint and shows empty states instead of invented numbers', () => {
  const s = src('pages/Dashboard.jsx')
  assert.match(s, /dashboardApi\.getPreparation/)
  for (const c of ['ReadinessRing', 'TopicMap', 'GoalsPanel', 'Heatmap', 'DashboardSkeleton']) assert.ok(s.includes(c), c)
  assert.match(s, /No completed interviews yet/); assert.match(s, /methodology/)
  assert.equal(/Math\.random|mockData/.test(s), false, 'no fabricated data')
})
test('goals panel validates whole numbers and saves through the API', () => {
  const s = src('components/GoalsPanel.jsx')
  assert.match(s, /dashboardApi\.setGoals/); assert.match(s, /0 to 50/); assert.match(s, /0 to 200/)
})
test('readiness card always shows its limitations and never a score without data', () => {
  const s = src('components/ReadinessRing.jsx')
  assert.match(s, /limitations/); assert.match(s, /has \? readiness\.score : '—'/)
})
test('progress page uses both endpoints and survives one failing', () => {
  const s = src('pages/ProgressDashboard.jsx')
  assert.match(s, /Promise\.allSettled/); assert.match(s, /getPerformance/); assert.match(s, /getPreparation/)
})
test('results page shows the previous-attempt comparison and a scoring guide', () => {
  assert.match(src('pages/InterviewResults.jsx'), /ComparisonPanel/); assert.match(src('pages/InterviewResults.jsx'), /How are these scores produced/)
  assert.match(src('components/ComparisonPanel.jsx'), /interviewApi\.getComparison/); assert.match(src('components/ComparisonPanel.jsx'), /different questions|note/)
})
test('admin overview calls both admin endpoints and is routed for admins, with a sidebar link', () => {
  const s = src('pages/AdminOverview.jsx'); assert.match(s, /adminApi\.overview/); assert.match(s, /adminApi\.serviceHealth/)
  const app = src('App.jsx'); assert.match(app, /path="\/admin\/overview"/)
  const roles = src('utils/roles.js'); assert.match(roles, /'\/admin\/overview'/); assert.match(roles, /label: 'Overview'/)
})
test('hirer dashboard renders the pipeline, weekly trend and job performance from the dashboard endpoint', () => {
  const s = src('pages/HirerDashboard.jsx')
  assert.match(s, /hirerApplicationApi\.dashboard/); assert.match(s, /applicationsByWeek/); assert.match(s, /firstReview/); assert.match(s, /Funnel/)
})
test('shared design system pieces exist and the layout has a skip link and responsive sidebar classes', () => {
  for (const f of ['PageHeader', 'StatCard', 'Panel', 'Badge', 'Skeleton', 'Heatmap', 'ChartTooltip']) assert.ok(fs.existsSync(path.join(__dirname, '../../../frontend/src/components', `${f}.jsx`)), f)
  assert.match(src('layouts/DashboardLayout.jsx'), /skip-link/)
  const css = src('index.css'); for (const k of ['.sidebar', '.stat-card', '.panel', '.skeleton', '.heatmap', 'prefers-reduced-motion', '@media (max-width: 860px)']) assert.ok(css.includes(k), k)
})
test('coding list shows solved/attempted badges from /coding/progress and still works without them', () => {
  const s = src('pages/CodingProblems.jsx')
  assert.match(s, /codingApi\.getProgress/); assert.match(s, /Attempted, not solved/); assert.match(s, /setProgress\(new Map\(\)\)/)
  assert.match(src('services/api.js'), /\/coding\/progress/); assert.match(src('components/CodingProblemCard.jsx'), /Not started/)
})
