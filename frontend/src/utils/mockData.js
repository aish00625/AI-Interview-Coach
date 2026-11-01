/**
 * All temporary frontend-only mock data lives here (Phase 2 only).
 * Every mock export mirrors the shape the real API response will have,
 * so swapping a page from mock data to `services/api.js` later is a
 * one-line change, not a rewrite. Field names match Phase 1's schema.sql.
 */

export const mockInterviewQuestions = [
  { id: 1, sessionId: 101, topic: 'OOP', order: 1, text: 'Explain the difference between abstraction and encapsulation, with an example from a project you have built.' },
  { id: 2, sessionId: 101, topic: 'DBMS', order: 2, text: 'What is a database index, and when could adding one make a query slower rather than faster?' },
  { id: 3, sessionId: 101, topic: 'React', order: 3, text: 'Walk through what happens, render by render, when you call setState inside a click handler.' },
  { id: 4, sessionId: 101, topic: 'SQL', order: 4, text: 'Write a query to find the second-highest salary in an employees table without using LIMIT/OFFSET.' },
]

export const mockCodingProblems = [
  { id: 1, title: 'Two Sum', topic: 'Arrays', difficulty: 'easy', shortDescription: 'Return indices of two numbers that add up to a target.' },
  { id: 2, title: 'Longest Substring Without Repeating Characters', topic: 'Strings', difficulty: 'medium', shortDescription: 'Find the length of the longest substring without repeating characters.' },
  { id: 3, title: 'Merge Intervals', topic: 'Sorting', difficulty: 'medium', shortDescription: 'Merge all overlapping intervals in a list.' },
  { id: 4, title: 'Course Schedule', topic: 'Graphs', difficulty: 'hard', shortDescription: 'Determine if all courses can be finished given prerequisite pairs.' },
  { id: 5, title: 'Climbing Stairs', topic: 'Dynamic Programming', difficulty: 'easy', shortDescription: 'Count distinct ways to climb n stairs, 1 or 2 steps at a time.' },
  { id: 6, title: 'LRU Cache', topic: 'Hashing', difficulty: 'hard', shortDescription: 'Design a Least Recently Used cache with O(1) get and put.' },
]

export const mockCodingProblemDetail = {
  id: 1,
  title: 'Two Sum',
  topic: 'Arrays',
  difficulty: 'easy',
  description:
    'Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target. Assume exactly one solution exists, and you may not use the same element twice.',
  examples: [
    { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'nums[0] + nums[1] == 9' },
  ],
  constraints: '2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9',
}

export const mockDashboardStats = {
  interviewsCompleted: 12,
  codingProblemsSolved: 34,
  averageInterviewScore: 76,
  overallPracticeScore: 79,
}

export const mockRecentInterviews = [
  { id: 101, type: 'Technical', targetRole: 'Full Stack Developer', difficulty: 'medium', date: '2026-09-10', finalScore: 82, status: 'completed' },
  { id: 100, type: 'Behavioral', targetRole: 'Software Engineer', difficulty: 'easy', date: '2026-09-06', finalScore: 71, status: 'completed' },
  { id: 99, type: 'Mixed', targetRole: 'Data Engineer', difficulty: 'hard', date: '2026-08-29', finalScore: 65, status: 'completed' },
]

export const mockRecommendedQuestions = [
  { id: 1, topic: 'Hashing', reason: 'Weak in hashing — 2/6 recent problems solved' },
  { id: 2, topic: 'Dynamic Programming', reason: 'Not attempted yet at medium difficulty' },
  { id: 3, topic: 'System Design', reason: 'Lowest average interview score among technical topics' },
]

export const mockInterviewHistory = [
  { id: 101, date: '2026-09-10', type: 'Technical', targetRole: 'Full Stack Developer', difficulty: 'medium', finalScore: 82, status: 'completed' },
  { id: 100, date: '2026-09-06', type: 'Behavioral', targetRole: 'Software Engineer', difficulty: 'easy', finalScore: 71, status: 'completed' },
  { id: 99, date: '2026-08-29', type: 'Mixed', targetRole: 'Data Engineer', difficulty: 'hard', finalScore: 65, status: 'completed' },
  { id: 98, date: '2026-08-21', type: 'Technical', targetRole: 'Software Engineer', difficulty: 'medium', finalScore: null, status: 'abandoned' },
]

export const mockScoreOverTime = [
  { session: 'Jul 20', score: 58 },
  { session: 'Aug 02', score: 64 },
  { session: 'Aug 15', score: 69 },
  { session: 'Aug 29', score: 65 },
  { session: 'Sep 06', score: 71 },
  { session: 'Sep 10', score: 82 },
]

export const mockTopicPerformance = [
  { topic: 'Arrays', score: 88 },
  { topic: 'DP', score: 54 },
  { topic: 'Graphs', score: 61 },
  { topic: 'DBMS', score: 79 },
  { topic: 'OOP', score: 84 },
  { topic: 'System Design', score: 47 },
]

export const mockCodingAccuracy = [
  { difficulty: 'Easy', solved: 18, attempted: 20 },
  { difficulty: 'Medium', solved: 12, attempted: 22 },
  { difficulty: 'Hard', solved: 4, attempted: 14 },
]

// Mirrors the shape of `performance_scores` in database/schema.sql —
// used by pages/ProgressDashboard.jsx for its four top-line scores.
export const mockPerformanceBreakdown = {
  overallScore: 79,
  codingScore: 85,
  technicalInterviewScore: 78,
  communicationScore: 74,
}

export const mockAnswerFeedback = {
  technicalScore: 78,
  relevanceScore: 85,
  clarityScore: 72,
  completenessScore: 69,
  strengths: [
    'Correctly distinguished encapsulation from abstraction with a concrete example.',
    'Used precise terminology (interface vs implementation).',
  ],
  weaknesses: [
    'Did not mention access modifiers as an encapsulation mechanism.',
    'Answer ran long without a clear closing summary.',
  ],
  suggestedImprovement:
    'Lead with a one-sentence definition of each term before the example, then close with a one-line contrast so the interviewer can follow the structure even if they stop listening halfway.',
  modelAnswer:
    'Encapsulation is bundling data with the methods that operate on it and restricting direct access, e.g. private fields with public getters. Abstraction is exposing only relevant behavior while hiding implementation detail, e.g. a payment interface that hides how a provider is called. In short: encapsulation protects data, abstraction simplifies what the caller needs to know.',
}
