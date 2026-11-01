/**
 * Skill vocabulary: canonical names, their common spellings/abbreviations, and extraction of skills from free text.
 *
 * Why this exists: skills are free text entered by hirers (required skills) and candidates (profile). Without
 * normalisation "ReactJS", "react" and "React" become three different rows, so a candidate who knows React is shown
 * as missing a job's "ReactJS" requirement. Every skill name is now canonicalised before it is stored, and resume
 * text is scanned with the same table.
 *
 * Deliberate limits (documented, not hidden): matching is by word/alias, not by meaning. "Used a relational database"
 * does not imply SQL, and ambiguous one-letter names (C, R, Go) are intentionally NOT extracted from prose.
 */

// canonical -> aliases (the canonical name itself is always an alias). Canonical spellings of seeded skills are kept.
const SKILL_ALIASES = {
  Java: ['java', 'core java', 'java se', 'java 8', 'java 11', 'java 17'],
  Python: ['python', 'python3', 'python 3'],
  JavaScript: ['javascript', 'js', 'ecmascript', 'es6', 'es2015', 'vanilla js'],
  TypeScript: ['typescript', 'ts'],
  'C++': ['c++', 'cpp', 'cplusplus'],
  'C#': ['c#', 'csharp'],
  React: ['react', 'reactjs', 'react.js', 'react js'],
  'Node.js': ['node.js', 'nodejs', 'node js', 'node'],
  Express: ['express', 'expressjs', 'express.js'],
  Angular: ['angular', 'angularjs', 'angular.js'],
  Vue: ['vue', 'vuejs', 'vue.js'],
  HTML: ['html', 'html5'],
  CSS: ['css', 'css3'],
  SQL: ['sql', 'structured query language'],
  PostgreSQL: ['postgresql', 'postgres', 'psql', 'postgre sql'],
  MySQL: ['mysql', 'my sql'],
  MongoDB: ['mongodb', 'mongo', 'mongo db'],
  Redis: ['redis'],
  Docker: ['docker', 'dockerfile', 'docker compose', 'docker-compose'],
  Kubernetes: ['kubernetes', 'k8s'],
  'Spring Boot': ['spring boot', 'springboot', 'spring-boot'],
  Django: ['django'],
  Flask: ['flask'],
  Git: ['git', 'github', 'gitlab'],
  AWS: ['aws', 'amazon web services'],
  Linux: ['linux', 'ubuntu', 'unix'],
  'REST APIs': ['rest api', 'rest apis', 'restful', 'restful api', 'restful apis', 'rest'],
  'Data Structures': ['data structures', 'data structure', 'dsa', 'data structures and algorithms'],
  'Machine Learning': ['machine learning'],
}

/** Lower-cases and drops everything except letters, digits, + and # ("Node.js", "node js", "NodeJS" -> "nodejs"). */
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#]/g, '')

const ALIAS_TO_CANONICAL = new Map()
for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
  for (const a of [canonical, ...aliases]) {
    const key = squash(a)
    if (ALIAS_TO_CANONICAL.has(key) && ALIAS_TO_CANONICAL.get(key) !== canonical) throw new Error(`skill alias clash: ${a}`)
    ALIAS_TO_CANONICAL.set(key, canonical)
  }
}

/** Canonical spelling for a known skill/alias; otherwise the trimmed input with whitespace collapsed (custom skills are allowed). */
function canonicalSkillName(name) {
  const cleaned = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return ALIAS_TO_CANONICAL.get(squash(cleaned)) || cleaned
}

/** Same skill regardless of spelling/case? */
const sameSkill = (a, b) => canonicalSkillName(a).toLowerCase() === canonicalSkillName(b).toLowerCase()

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One regex per canonical skill. Boundaries treat + and # as part of a word so "c++" is not found inside "c+++" and
// "java" is not found inside "javascript"; a preceding "." is also excluded so the "js" in "Node.js" is not counted
// as a JavaScript mention. Aliases of 2 characters or fewer other than js/ts/c# are skipped.
const MATCHERS = Object.entries(SKILL_ALIASES).map(([canonical, aliases]) => {
  const all = [canonical, ...aliases].map((a) => a.toLowerCase()).filter((a, i, arr) => arr.indexOf(a) === i)
  const usable = all.filter((a) => a.length > 2 || ['js', 'ts', 'c#'].includes(a))
  const alt = usable.sort((x, y) => y.length - x.length).map(escapeRe).join('|')
  return { canonical, re: new RegExp(`(?<![a-z0-9+#.])(?:${alt})(?![a-z0-9+#])`, 'gi') }
})

// Plain words that are also skill aliases but, written alone, are usually ordinary English.
const WEAK_ALIASES = new Set(['node', 'rest', 'express', 'flask', 'git', 'react', 'mongo', 'vue', 'angular'])

/**
 * Finds known skills in free text (e.g. resume text). Returns [{ name, matchedAs: [..], mentions }], most-mentioned
 * first. Weak aliases (ordinary English words like "express" or "rest") only count when written with a stronger
 * form somewhere in the text or capitalised as a proper name.
 */
function extractSkills(text) {
  const source = String(text ?? '')
  if (!source.trim()) return []
  const found = []
  for (const { canonical, re } of MATCHERS) {
    re.lastIndex = 0
    const hits = new Map()
    let m
    while ((m = re.exec(source)) !== null) {
      const raw = m[0]
      const weak = WEAK_ALIASES.has(raw.toLowerCase())
      // weak alias in lower case, e.g. "rest of the team", "express interest": ignore. "React", "Node", "Express" capitalised: keep.
      if (weak && raw === raw.toLowerCase()) continue
      hits.set(raw, (hits.get(raw) || 0) + 1)
    }
    if (hits.size) {
      found.push({ name: canonical, matchedAs: [...hits.keys()], mentions: [...hits.values()].reduce((a, b) => a + b, 0) })
    }
  }
  return found.sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
}

module.exports = { SKILL_ALIASES, canonicalSkillName, sameSkill, extractSkills }
