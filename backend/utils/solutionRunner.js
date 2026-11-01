const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

/**
 * Runs TRUSTED, repository-authored solutions (reference/oracle/wrong programs under data/coding-problems) with the
 * interpreters installed on THIS machine. It is a verification aid for problem authors; it is NOT how user code is
 * executed (that always goes through the isolated Docker code executor) and must never be pointed at user input.
 */
const TIMEOUT_MS = 15000
const probe = (cmd, args) => { try { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000 }); return r.status === 0 ? `${r.stdout}${r.stderr}` : null } catch { return null } }

let cache
function toolchains() {
  if (cache) return cache
  const tc = { node: { cmd: process.execPath, args: [] } }
  for (const c of [['python3', []], ['python', []], ['py', ['-3']]]) {
    const out = probe(c[0], [...c[1], '--version'])
    if (out && /Python 3/.test(out)) { tc.python = { cmd: c[0], args: c[1] }; break }
  }
  if (probe('javac', ['-version']) !== null && probe('java', ['-version']) !== null) tc.java = { cmd: 'java', javac: 'javac' }
  const cxx = ['g++', 'c++'].find((c) => probe(c, ['--version']) !== null)
  if (cxx) tc.cpp = { cmd: cxx }
  return (cache = tc)
}

const LANG_OF_EXT = { '.py': 'python', '.js': 'javascript', '.java': 'java', '.cpp': 'cpp' }
const languageOf = (file) => LANG_OF_EXT[path.extname(file)]
const TOOLCHAIN_KEY = { python: 'python', javascript: 'node', java: 'java', cpp: 'cpp' }

/** Prepares a solution (compiling if needed) and returns { run(input) -> {stdout, error, timedOut}, dispose() } or { unavailable: reason }. */
function prepare(file) {
  const lang = languageOf(file)
  const tc = toolchains()[TOOLCHAIN_KEY[lang]]
  if (!lang) return { unavailable: `unsupported file type ${path.extname(file)}` }
  if (!tc) return { unavailable: `${lang} toolchain not found on this machine` }
  let tmp = null; let argv
  if (lang === 'python') argv = [tc.cmd, [...tc.args, file]]
  else if (lang === 'javascript') argv = [tc.cmd, [file]]
  else {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'problem-sol-'))
    if (lang === 'java') {
      fs.copyFileSync(file, path.join(tmp, 'Main.java'))
      const c = spawnSync(tc.javac, ['-d', tmp, path.join(tmp, 'Main.java')], { encoding: 'utf8', timeout: 60000 })
      if (c.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); return { unavailable: `compile error: ${(c.stderr || '').slice(0, 300)}` } }
      argv = [tc.cmd, ['-cp', tmp, 'Main']]
    } else {
      const exe = path.join(tmp, process.platform === 'win32' ? 'prog.exe' : 'prog')
      const c = spawnSync(tc.cmd, ['-O2', '-std=c++17', '-o', exe, file], { encoding: 'utf8', timeout: 60000 })
      if (c.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); return { unavailable: `compile error: ${(c.stderr || '').slice(0, 300)}` } }
      argv = [exe, []]
    }
  }
  return {
    lang,
    run(input) {
      const r = spawnSync(argv[0], argv[1], { input, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
      if (r.error && r.error.code === 'ETIMEDOUT') return { stdout: '', timedOut: true }
      if (r.error) return { stdout: '', error: r.error.message }
      if (r.status !== 0) return { stdout: r.stdout || '', error: `exit ${r.status}: ${(r.stderr || '').slice(0, 200)}` }
      return { stdout: r.stdout }
    },
    dispose() { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) },
  }
}

/**
 * Same comparison as the code executor: both sides trimmed, then exact string equality.
 * The only addition is CRLF -> LF. The real executor runs on Linux where programs emit "\n"; on a Windows host the local
 * Python interpreter translates "\n" to "\r\n" on stdout, which made every multi-line answer look wrong. Nothing else
 * (spaces, ordering, case) is normalised, so this does not make the check any more lenient.
 */
const normalizeEol = (s) => String(s).replace(/\r\n/g, '\n')
const sameOutput = (actual, expected) => normalizeEol(actual).trim() === normalizeEol(expected).trim()

/** Runs one solution file over all tests. Returns { file, lang, unavailable? , passed, total, failures:[{index, reason}] }. */
function runSolution(file, tests) {
  const prepared = prepare(file)
  if (prepared.unavailable) return { file, unavailable: prepared.unavailable, passed: 0, total: tests.length, failures: [] }
  try {
    const failures = []
    tests.forEach((t, i) => {
      const r = prepared.run(t.input)
      if (r.timedOut) failures.push({ index: i + 1, reason: 'timed out' })
      else if (r.error) failures.push({ index: i + 1, reason: r.error })
      else if (!sameOutput(r.stdout, t.expected_output)) failures.push({ index: i + 1, reason: 'wrong answer' })
    })
    return { file, lang: prepared.lang, passed: tests.length - failures.length, total: tests.length, failures }
  } finally { prepared.dispose() }
}

module.exports = { runSolution, toolchains, sameOutput, languageOf }
