const topicModel = require('../models/topicModel')
const { selectPersonalized } = require('../utils/questionSelector')
const { canonicalSkillName } = require('../utils/skillSynonyms')

/**
 * Phase 6 question generation — deterministic, local, NOT AI-generated.
 *
 * This is a small local question bank selected by interview type and
 * difficulty. `targetRole` is accepted in the function signature (and
 * used by Phase 7's real AI-driven generation) but this simple bank
 * doesn't yet differentiate questions by role — noted here rather than
 * silently ignored.
 *
 * `topicName` maps to a row in the `topics` lookup table where one
 * exists; `null` means the question doesn't correspond to a specific
 * CS topic (behavioral/HR questions, or a language-specific question
 * with no matching topic row) — `interview_questions.topic_id` is
 * nullable in the schema specifically to allow this.
 *
 * Phase 7 replaces the body of `generateInterviewQuestions` with a call
 * to the Python AI service; the function signature and return shape
 * (an array of { questionText, topicId, orderIndex }) stay the same, so
 * nothing calling this needs to change.
 */

const QUESTIONS_PER_SESSION = 5

const QUESTION_BANK = {
  technical: [
    { topicName: 'OOP', difficulty: 'easy', text: 'What are the four main principles of Object-Oriented Programming?' },
    { topicName: 'OOP', difficulty: 'medium', text: 'Explain the difference between method overloading and method overriding.' },
    { topicName: 'DBMS', difficulty: 'easy', text: 'What is database normalization and why is it used?' },
    { topicName: 'DBMS', difficulty: 'medium', text: 'What is the difference between a primary key and a foreign key?' },
    { topicName: 'Operating Systems', difficulty: 'easy', text: 'What is the difference between a process and a thread?' },
    { topicName: 'Operating Systems', difficulty: 'medium', text: 'What is a deadlock, and name one way to prevent it?' },
    { topicName: 'Searching', difficulty: 'easy', text: 'What is the time complexity of binary search, and what precondition does it require?' },
    { topicName: 'Sorting', difficulty: 'medium', text: 'Compare the average-case time complexity of quicksort and mergesort.' },
    { topicName: 'Arrays', difficulty: 'easy', text: 'How would you find two elements in an array that sum to a target value?' },
    { topicName: 'Dynamic Programming', difficulty: 'hard', text: 'What distinguishes a dynamic programming solution from plain recursion?' },
    { topicName: null, difficulty: 'easy', text: 'What is the difference between var, let, and const in JavaScript?' },
    { topicName: 'Trees', difficulty: 'medium', text: 'Describe how you would check whether a binary tree is height-balanced.' },
    { topicName: 'Graphs', difficulty: 'hard', text: 'Explain the difference between BFS and DFS, and when you would use each.' },
    { topicName: 'System Design', difficulty: 'medium', text: 'How would you design a URL-shortening service at a high level?' },
    { topicName: 'Networking', difficulty: 'easy', text: 'At a high level, what happens when you type a URL into a browser and press enter?' },
  ],
  behavioral: [
    { topicName: null, difficulty: 'easy', text: "Tell me about a time you disagreed with a teammate. How did you handle it?" },
    { topicName: null, difficulty: 'easy', text: 'Describe a project you are proud of and what your specific contribution was.' },
    { topicName: null, difficulty: 'medium', text: 'Tell me about a time you missed a deadline. What happened, and what did you learn?' },
    { topicName: null, difficulty: 'medium', text: 'Describe a situation where you had to learn something new quickly to finish a task.' },
    { topicName: null, difficulty: 'hard', text: 'Tell me about a time you had to push back on a decision you thought was wrong.' },
  ],
  hr: [
    { topicName: null, difficulty: 'easy', text: 'Why are you interested in this role?' },
    { topicName: null, difficulty: 'easy', text: 'Where do you see yourself in three to five years?' },
    { topicName: null, difficulty: 'medium', text: 'What are your salary expectations for this position?' },
    { topicName: null, difficulty: 'medium', text: 'Why are you looking to leave your current position?' },
    { topicName: null, difficulty: 'hard', text: 'What is a weakness you are actively working to improve?' },
  ],
}

function poolForType(interviewType) {
  if (interviewType === 'mixed') {
    return [...QUESTION_BANK.technical, ...QUESTION_BANK.behavioral, ...QUESTION_BANK.hr]
  }
  return QUESTION_BANK[interviewType] || []
}

/**
 * Skill tags for a few of the original questions (used only by personalised practice selection; the original
 * assessment selection below ignores tags entirely).
 */
const LEGACY_TAGS = {
  'What is the difference between var, let, and const in JavaScript?': ['JavaScript'],
  'What is database normalization and why is it used?': ['SQL', 'PostgreSQL'],
  'What is the difference between a primary key and a foreign key?': ['SQL', 'PostgreSQL'],
}

/**
 * PRACTICE-ONLY technical questions (Phase I). Each has a matching rubric in ai-service/app/data/reference_bank.json
 * (a test keeps the two in sync). They are deliberately EXCLUDED from the original selection path used for job
 * assessments, so every applicant to a job keeps getting the same questions no matter how this list grows.
 * tags = skills (canonical names) the question exercises; roles = role keywords it is relevant to.
 */
const PRACTICE_ONLY_TECHNICAL = [
  { topicName: 'OOP', difficulty: 'medium', text: 'What is the difference between an interface and an abstract class in Java?', tags: ['Java'], roles: ['backend'] },
  { topicName: null, difficulty: 'hard', text: 'How does garbage collection work in Java at a high level?', tags: ['Java'], roles: ['backend'] },
  { topicName: 'Arrays', difficulty: 'easy', text: 'What is the difference between a list and a tuple in Python?', tags: ['Python'], roles: ['backend', 'data'] },
  { topicName: null, difficulty: 'medium', text: 'What are Python decorators and when would you use one?', tags: ['Python'], roles: ['backend'] },
  { topicName: null, difficulty: 'medium', text: 'What is a closure in JavaScript, and when is it useful?', tags: ['JavaScript'], roles: ['frontend', 'backend'] },
  { topicName: null, difficulty: 'hard', text: 'How does the JavaScript event loop work?', tags: ['JavaScript', 'Node.js'], roles: ['frontend', 'backend'] },
  { topicName: null, difficulty: 'easy', text: 'What is the difference between state and props in React?', tags: ['React'], roles: ['frontend'] },
  { topicName: null, difficulty: 'medium', text: 'When does a React component re-render, and how can you avoid unnecessary re-renders?', tags: ['React'], roles: ['frontend'] },
  { topicName: null, difficulty: 'medium', text: 'What does it mean that Node.js is single-threaded and non-blocking?', tags: ['Node.js'], roles: ['backend'] },
  { topicName: 'DBMS', difficulty: 'easy', text: 'What is the difference between an INNER JOIN and a LEFT JOIN?', tags: ['SQL', 'PostgreSQL', 'MySQL'], roles: ['backend', 'data'] },
  { topicName: 'DBMS', difficulty: 'medium', text: 'What is a database index, and what is the trade-off of adding one?', tags: ['SQL', 'PostgreSQL', 'MySQL'], roles: ['backend', 'data'] },
  { topicName: 'DBMS', difficulty: 'medium', text: 'When would you choose a document database like MongoDB over a relational database?', tags: ['MongoDB'], roles: ['backend', 'data'] },
  { topicName: null, difficulty: 'easy', text: 'What is the difference between a Docker image and a container?', tags: ['Docker'], roles: ['devops', 'backend'] },
  { topicName: null, difficulty: 'easy', text: 'What is the difference between a pointer and a reference in C++?', tags: ['C++'], roles: ['backend'] },
  { topicName: null, difficulty: 'medium', text: "What does Spring Boot's auto-configuration do?", tags: ['Spring Boot', 'Java'], roles: ['backend'] },
  { topicName: 'Networking', difficulty: 'medium', text: 'What makes an API RESTful, and what do the common HTTP methods mean?', tags: ['REST APIs', 'Node.js'], roles: ['backend', 'fullstack'] },
  { topicName: 'Hashing', difficulty: 'easy', text: 'How does a hash table handle collisions?', tags: ['Data Structures'], roles: [] },
  { topicName: 'Stack', difficulty: 'easy', text: 'When would you use a stack versus a queue?', tags: ['Data Structures'], roles: [] },
]

/** Whole bank flattened with the interview type on every entry (used by personalised practice). */
function flatBank() {
  const withType = (type, list, extra = {}) => list.map((q) => ({ tags: [], roles: [], ...q, tags: q.tags || LEGACY_TAGS[q.text] || [], type, ...extra }))
  return [
    ...withType('technical', QUESTION_BANK.technical),
    ...withType('technical', PRACTICE_ONLY_TECHNICAL, { practiceOnly: true }),
    ...withType('behavioral', QUESTION_BANK.behavioral),
    ...withType('hr', QUESTION_BANK.hr),
  ]
}

function practicePool(interviewType) {
  const all = flatBank()
  return interviewType === 'mixed' ? all : all.filter((q) => q.type === interviewType)
}

/** How many practice questions exercise a skill (any spelling). Used to point at practice for a skill gap. */
function practiceQuestionCountForSkill(skillName) {
  const target = canonicalSkillName(skillName).toLowerCase()
  return flatBank().filter((q) => q.type === 'technical' && q.tags.some((t) => canonicalSkillName(t).toLowerCase() === target)).length
}

/** All question texts, for consistency checks against the evaluator's rubric bank. */
function allQuestionTexts() {
  return flatBank().map((q) => q.text)
}

/**
 * Picks up to QUESTIONS_PER_SESSION questions: prefers exact difficulty
 * matches (in bank order, so results are stable/deterministic — not
 * random), then fills any remaining slots from the rest of the pool.
 */
function selectQuestions(pool, difficulty) {
  const matching = pool.filter((q) => q.difficulty === difficulty)
  const rest = pool.filter((q) => q.difficulty !== difficulty)
  return [...matching, ...rest].slice(0, QUESTIONS_PER_SESSION)
}

/**
 * Without `personalization` this is exactly the original deterministic selection (used for job assessments, so all
 * applicants get the same questions). With `personalization` ({ profile, weakTopics, recentTexts }) - which callers
 * pass for private practice only - questions are chosen by skill, weak topic, target role and recency, and each
 * returned question carries the reasons it was chosen.
 */
async function generateInterviewQuestions({ interviewType, targetRole, difficulty, personalization = null }) {
  let selected
  let reasonsByIndex = null
  if (personalization) {
    const picks = selectPersonalized({
      pool: practicePool(interviewType), interviewType, difficulty, count: QUESTIONS_PER_SESSION,
      profile: { ...(personalization.profile || {}), targetRole: personalization.profile?.targetRole || targetRole },
      weakTopics: personalization.weakTopics || [], recentTexts: personalization.recentTexts || [],
    })
    selected = picks.map((p) => p.question)
    reasonsByIndex = picks.map((p) => p.reasons)
  } else {
    selected = selectQuestions(poolForType(interviewType), difficulty)
  }

  // Resolve each question's topic name to a topics.id once, via a single
  // lookup table fetch rather than one query per question.
  const topics = await topicModel.getAllTopics()
  const topicIdByName = new Map(topics.map((t) => [t.name, t.id]))

  return selected.map((q, index) => ({
    questionText: q.text,
    topicId: q.topicName ? topicIdByName.get(q.topicName) ?? null : null,
    orderIndex: index + 1,
    ...(reasonsByIndex ? { reasons: reasonsByIndex[index] } : {}),
  }))
}

module.exports = { generateInterviewQuestions, QUESTIONS_PER_SESSION, practiceQuestionCountForSkill, allQuestionTexts }
