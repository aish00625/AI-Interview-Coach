// Phase I pure logic: skill vocabulary, job-fit explanation, personalised selection, adaptive difficulty, and the
// consistency of the question bank with the evaluator's rubric file.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const { root, stubModule } = require('../phaseA/helpers')
stubModule('config/db', { pool: { query: async () => ({ rows: [] }) } })
const { canonicalSkillName, extractSkills, sameSkill, SKILL_ALIASES } = require(path.join(root, 'utils/skillSynonyms.js'))
const { selectPersonalized, adaptDifficulty, roleKeywords } = require(path.join(root, 'utils/questionSelector.js'))
const { computeFit } = require(path.join(root, 'services/skillInsightService.js'))
const qs = require(path.join(root, 'services/interviewQuestionService.js'))

test('canonicalSkillName: spellings of one skill collapse; unknown skills are kept as typed', () => {
  for (const v of ['ReactJS', 'react.js', 'React JS', 'react']) assert.equal(canonicalSkillName(v), 'React')
  for (const v of ['nodejs', 'Node JS', 'node.js']) assert.equal(canonicalSkillName(v), 'Node.js')
  assert.equal(canonicalSkillName('postgres'), 'PostgreSQL'); assert.equal(canonicalSkillName('CPP'), 'C++'); assert.equal(canonicalSkillName('springboot'), 'Spring Boot')
  assert.equal(canonicalSkillName('  Figma   Design '), 'Figma Design')
  assert.equal(canonicalSkillName(''), ''); assert.equal(canonicalSkillName(null), '')
  assert.ok(sameSkill('JS', 'javascript')); assert.ok(!sameSkill('Java', 'JavaScript'))
  // seeded skill names keep their exact spelling
  for (const n of ['Java', 'Python', 'JavaScript', 'C++', 'React', 'Node.js', 'SQL', 'PostgreSQL', 'MongoDB', 'Docker', 'Spring Boot']) assert.equal(canonicalSkillName(n), n)
  assert.ok(Object.keys(SKILL_ALIASES).length >= 25)
})

test('extractSkills: finds real mentions, avoids look-alikes, ignores ordinary English', () => {
  const text = 'Built REST APIs with Node.js and Express, JavaScript (ES6), Postgres and Docker. I express interest; the rest of the team used Java. Also C++ and C#. Used React daily.'
  const names = extractSkills(text).map((s) => s.name)
  for (const n of ['Node.js', 'Express', 'JavaScript', 'PostgreSQL', 'Docker', 'Java', 'C++', 'C#', 'React', 'REST APIs']) assert.ok(names.includes(n), `missing ${n}: ${names}`)
  assert.ok(!extractSkills('I like javascript only').map((s) => s.name).includes('Java'), 'Java must not match inside JavaScript')
  assert.ok(!extractSkills('Node.js developer').map((s) => s.name).includes('JavaScript'), 'the js in Node.js is not a JavaScript mention')
  assert.deepEqual(extractSkills('I express interest in the rest of the team, a flask of tea'), [], 'lower-case English words are not skills')
  assert.deepEqual(extractSkills(''), []); assert.deepEqual(extractSkills(null), [])
  const counted = extractSkills('Python Python python3')
  assert.equal(counted[0].mentions, 3)
})

test('computeFit: matches by profile/resume with evidence, mandatory counts, experience message, next steps', () => {
  const fit = computeFit({
    requiredSkills: [{ name: 'React', mandatory: true }, { name: 'SQL', mandatory: true }, { name: 'Docker', mandatory: false }],
    profileSkills: ['reactjs'], resumeSkills: [{ name: 'SQL', matchedAs: ['Postgres-SQL'] }],
    jobLevel: 'experienced', yourLevel: 'fresher', practiceCount: (s) => (s === 'Docker' ? 1 : 0),
  })
  assert.deepEqual(fit.skills.map((s) => [s.name, s.status, s.source]), [['React', 'matched', 'profile'], ['SQL', 'matched', 'resume'], ['Docker', 'missing', null]])
  assert.deepEqual(fit.summary, { requiredTotal: 3, matched: 2, mandatoryTotal: 2, mandatoryMatched: 2, percent: 67 })
  assert.equal(fit.experience.status, 'mismatch'); assert.match(fit.experience.message, /only apply when it matches/)
  assert.ok(fit.nextSteps.some((n) => /Docker/.test(n) && /1 practice question/.test(n)))
  assert.ok(fit.nextSteps.some((n) => /"SQL" appears in your resume but not on your profile/.test(n)))
  assert.match(fit.disclaimer, /not a hiring decision/)
  assert.equal(computeFit({ requiredSkills: [], profileSkills: [], jobLevel: 'any', yourLevel: 'fresher' }).summary.percent, null)
})

test('adaptDifficulty: needs history, moves one step, explains itself, practice rules only', () => {
  assert.equal(adaptDifficulty({ requested: 'medium', recentScores: [90] }).changed, false)
  assert.match(adaptDifficulty({ requested: 'medium', recentScores: [90] }).reason, /at least 2/)
  assert.deepEqual(adaptDifficulty({ requested: 'medium', recentScores: [88, 80, 79] }).difficulty, 'hard')
  assert.deepEqual(adaptDifficulty({ requested: 'medium', recentScores: [30, 40] }).difficulty, 'easy')
  assert.equal(adaptDifficulty({ requested: 'hard', recentScores: [95, 90] }).difficulty, 'hard', 'never beyond hard')
  assert.equal(adaptDifficulty({ requested: 'easy', recentScores: [10, 20] }).difficulty, 'easy', 'never below easy')
  assert.equal(adaptDifficulty({ requested: 'medium', recentScores: [60, 62] }).changed, false)
  assert.match(adaptDifficulty({ requested: 'medium', recentScores: [88, 80] }).reason, /averaged 84\/100.*raised from medium to hard/)
})


const pool = [
  { text: 'JS closure', type: 'technical', topicName: null, difficulty: 'medium', tags: ['JavaScript'], roles: ['frontend'] },
  { text: 'React props', type: 'technical', topicName: null, difficulty: 'easy', tags: ['React'], roles: ['frontend'] },
  { text: 'SQL join', type: 'technical', topicName: 'DBMS', difficulty: 'easy', tags: ['SQL'], roles: ['backend'] },
  { text: 'SQL index', type: 'technical', topicName: 'DBMS', difficulty: 'medium', tags: ['SQL'], roles: ['backend'] },
  { text: 'Graph BFS', type: 'technical', topicName: 'Graphs', difficulty: 'medium', tags: [], roles: [] },
  { text: 'Docker image', type: 'technical', topicName: null, difficulty: 'easy', tags: ['Docker'], roles: ['devops'] },
  { text: 'Disagreement', type: 'behavioral', topicName: null, difficulty: 'easy', tags: [], roles: [] },
  { text: 'Why role', type: 'hr', topicName: null, difficulty: 'easy', tags: [], roles: [] },
]
const techPool = pool.filter((q) => q.type === 'technical') // the service filters the pool by interview type before selecting
const pick = (extra) => selectPersonalized({ pool: techPool, interviewType: 'technical', difficulty: 'medium', count: 3, ...extra }).map((p) => p.question.text)

test('selectPersonalized: skill match beats an otherwise equal question', () => {
  const picks = selectPersonalized({ pool: pool.filter((q) => q.type === 'technical'), interviewType: 'technical', difficulty: 'medium', count: 2, profile: { skills: ['ReactJS', 'docker'] } })
  const texts = picks.map((p) => p.question.text)
  assert.ok(texts.includes('React props') && texts.includes('Docker image'), texts.join(','))
  assert.ok(picks.find((p) => p.question.text === 'React props').reasons[0].startsWith('Matches your skill: React'))
})

test('selectPersonalized: weak topics are targeted with the average shown; strong topics are not', () => {
  const weak = selectPersonalized({ pool: techPool, interviewType: 'technical', difficulty: 'medium', count: 2, weakTopics: [{ topicName: 'Graphs', average: 32 }] })
  assert.equal(weak[0].question.text, 'Graph BFS'); assert.match(weak[0].reasons.join(' '), /weaker topic: Graphs.*32\/100/)
  const strong = selectPersonalized({ pool: techPool, interviewType: 'technical', difficulty: 'medium', count: 2, weakTopics: [{ topicName: 'Graphs', average: 90 }] })
  assert.ok(!strong.some((p) => p.reasons.some((r) => /weaker topic/.test(r))))
})

test('selectPersonalized: target role, recency penalty, diversity, determinism, fallback fill', () => {
  assert.equal(pick({ profile: { targetRole: 'Back-End Developer' } })[0].startsWith('SQL'), true)
  assert.ok(roleKeywords('Full Stack Engineer').has('backend') && roleKeywords('Full Stack Engineer').has('frontend'))
  assert.ok(!pick({ profile: { skills: ['SQL'] }, recentTexts: ['SQL index', 'SQL join'] }).slice(0, 1).includes('SQL index'), 'recently asked questions are pushed down')
  const a = pick({ profile: { skills: ['SQL', 'React'] } }); const b = pick({ profile: { skills: ['SQL', 'React'] } })
  assert.deepEqual(a, b)
  const two = pick({ profile: { skills: ['SQL'] } })
  assert.ok(!(two.includes('SQL join') && two.includes('SQL index') && two.length === 2), 'diversity discount spreads picks across topics')
  assert.equal(selectPersonalized({ pool: techPool, interviewType: 'technical', difficulty: 'easy', count: 99 }).length, 6, 'returns what exists when fewer than requested')
  for (const p of selectPersonalized({ pool: techPool, interviewType: 'technical', difficulty: 'medium', count: 5 })) assert.ok(p.reasons.length >= 1)
})

test('selectPersonalized: mixed interviews keep a realistic technical/behavioural/HR mix', () => {
  const mixed = selectPersonalized({ pool, interviewType: 'mixed', difficulty: 'easy', count: 5, profile: { skills: ['SQL', 'React', 'Docker'] } })
  const types = mixed.map((m) => m.question.type)
  assert.equal(types.filter((t) => t === 'technical').length, 3); assert.ok(types.includes('behavioral') && types.includes('hr'))
})

test('question bank: practice-only questions never enter the assessment path, and every question has a rubric', async () => {
  const texts = qs.allQuestionTexts()
  assert.equal(texts.length, 43); assert.equal(new Set(texts).size, 43, 'no duplicate question text')
  const rubric = JSON.parse(fs.readFileSync(path.join(root, '../ai-service/app/data/reference_bank.json'), 'utf8'))
  const rubricQuestions = new Set(rubric.entries.flatMap((e) => e.questions))
  for (const t of texts) assert.ok(rubricQuestions.has(t), `no rubric for: ${t}`)
  for (const q of rubricQuestions) assert.ok(texts.includes(q), `rubric for a question that does not exist: ${q}`)
  assert.ok(qs.practiceQuestionCountForSkill('ReactJS') >= 2); assert.equal(qs.practiceQuestionCountForSkill('Figma'), 0)
})
