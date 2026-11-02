// TEST-ONLY drop-in for `config/db`'s pool, backed by real PostgreSQL through
// persistent psql sessions. Supports pool.query, pool.connect() with real
// BEGIN/COMMIT/ROLLBACK on one session, parameters (PREPARE/EXECUTE with
// escaped literals), SQLSTATE error codes. Rows come back JSON-typed:
// bigint/numeric are JS numbers and timestamps are ISO strings (real `pg`
// returns strings/Date for those; set AIC_TEST_BIGINT_STRINGS=1 to get string ids) - so project code under test must not rely
// on that distinction (compare ids with String(), wrap numerics in Number()).
const { spawn } = require('child_process')

function lit(v) {
  if (v === null || v === undefined) return 'NULL'
  if (Array.isArray(v)) return `'{${v.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/(["\\])/g, '\\$1')}"`)).join(',')}}'`.replace(/'/g, "'")
  if (v instanceof Date) return `'${v.toISOString()}'`
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  return `'${String(v).replace(/'/g, "''")}'`
}
function arrLit(v) { // proper escaping of the whole array literal for SQL
  const inner = v.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/(["\\])/g, '\\$1')}"`)).join(',')
  return `'{${inner.replace(/'/g, "''")}}'`
}
function parseCsv(out) {
  const rows = []; let row = [], f = '', q = false
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (q) { if (c === '"') { if (out[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else f += c
  }
  return rows
}
function wrap(text) {
  const t = text.trim().replace(/;\s*$/, '')
  if (/^(begin|commit|rollback|savepoint|release)\b/i.test(t)) return { sql: t, direct: true }
  if (/^\(|^(select|with|values)\b/i.test(t)) return { sql: `SELECT row_to_json(_q) AS j FROM (${t}) _q` }
  if (/^(insert|update|delete)\b/i.test(t) && /\breturning\b/i.test(t)) return { sql: `WITH _q AS (${t}) SELECT row_to_json(_q) AS j FROM _q` }
  return { sql: t }
}

class Session {
  constructor({ db, port, host }) {
    this.child = spawn('psql', ['-h', host, '-p', String(port), '-U', 'postgres', '-d', db, '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=0'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.buf = ''; this.queue = []; this.current = null; this.n = 0; this.closed = false
    // psql on Windows ends lines with CRLF; values never contain a raw newline (row_to_json escapes them), so normalising is safe.
    this.child.stdout.on('data', (d) => { this.buf += String(d).replace(/\r\n/g, '\n'); this._drain() })
    this.child.stderr.on('data', () => {})
    this.child.on('error', (e) => this._failAll(e))
  }
  _failAll(e) { if (this.current) this.current.reject(e); this.queue.splice(0).forEach((q) => q.reject(e)); this.current = null }
  query(text, params = []) { return new Promise((resolve, reject) => { this.queue.push({ text, params, resolve, reject }); this._pump() }) }
  _pump() {
    if (this.current || !this.queue.length) return
    this.current = this.queue.shift()
    const { text, params } = this.current
    const { sql, direct } = wrap(text)
    const lits = params.map((p) => (Array.isArray(p) ? arrLit(p) : lit(p)))
    let script
    if (direct) script = `${sql};\n`
    else {
      const name = `s${++this.n}`
      script = `PREPARE ${name} AS ${sql};\n\\if :ERROR\n\\echo __ERR__ :LAST_ERROR_SQLSTATE :LAST_ERROR_MESSAGE\n\\else\nEXECUTE ${name}${lits.length ? `(${lits.join(', ')})` : ''};\n\\if :ERROR\n\\echo __ERR__ :LAST_ERROR_SQLSTATE :LAST_ERROR_MESSAGE\n\\endif\n\\endif\n`
    }
    if (direct) script += `\\if :ERROR\n\\echo __ERR__ :LAST_ERROR_SQLSTATE :LAST_ERROR_MESSAGE\n\\endif\n`
    script += `\\echo __END__\n`
    this.timer = setTimeout(() => this._failAll(new Error('psql query timeout')), 30000)
    this.child.stdin.write(script)
  }
  _drain() {
    const i = this.buf.indexOf('__END__\n')
    if (i === -1 || !this.current) return
    const chunk = this.buf.slice(0, i); this.buf = this.buf.slice(i + 8)
    clearTimeout(this.timer)
    const cur = this.current; this.current = null
    const errAt = chunk.indexOf('__ERR__ ')
    if (errAt !== -1) {
      const line = chunk.slice(errAt + 8).split('\n')[0]
      const sp = line.indexOf(' ')
      const err = new Error(line.slice(sp + 1)); err.code = line.slice(0, sp)
      cur.reject(err)
    } else {
      try {
        const parsed = parseCsv(chunk.trim() ? chunk : '')
        let rows = parsed.length > 1 ? parsed.slice(1).map((r) => JSON.parse(r[0])) : []
        // AIC_TEST_BIGINT_STRINGS=1 mimics the real `pg` driver for BIGINT key columns: `id` and `*_id` come back as STRINGS.
        // (Default stays numeric so every existing test is unchanged; the id-type bug in the coding list hid behind this.)
        if (process.env.AIC_TEST_BIGINT_STRINGS === '1') rows = rows.map((r) => { const o = { ...r }; for (const k of Object.keys(o)) if ((k === 'id' || k.endsWith('_id')) && typeof o[k] === 'number') o[k] = String(o[k]); return o })
        cur.resolve({ rows, rowCount: rows.length })
      } catch (e) {
        cur.reject(new Error(`pgshim could not parse result: ${e.message}`))
      }
    }
    this._pump()
  }
  close() { this.closed = true; try { this.child.stdin.end() } catch { /* ignore */ } }
}

// Defaults follow AIC_TEST_HOST / AIC_TEST_PORT (as CI sets them) so a test that passes only { db } reaches the same server.
function makePool({ db, port = process.env.AIC_TEST_PORT || 55432, host = process.env.AIC_TEST_HOST || '/tmp' }) {
  const opts = { db, port, host }
  const sessions = []
  let shared = null
  const pool = {
    query(text, params) { if (!shared) { shared = new Session(opts); sessions.push(shared) } return shared.query(text, params) },
    async connect() {
      const s = new Session(opts); sessions.push(s)
      return { query: (t, p) => s.query(t, p), release() { s.close() } }
    },
    closeAll() { sessions.forEach((s) => s.close()) },
  }
  return pool
}
module.exports = makePool
