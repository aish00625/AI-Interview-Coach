import Card from './Card.jsx'
import ExecutionSummary from './ExecutionSummary.jsx'

const mono = { background: 'var(--ink-900)', padding: 8, borderRadius: 6, fontSize: '0.8rem', whiteSpace: 'pre-wrap', margin: 0, overflowX: 'auto' }

/** Result of "Run Code": sample tests only, with expected vs actual output. Nothing here was saved. */
export default function RunResults({ result }) {
  return (
    <div>
      <ExecutionSummary run={result} />
      <p className="small muted" style={{ margin: '8px 0 6px' }}>Sample run only — not saved, no attempt used.</p>
      {result.summary?.headline && <p style={{ margin: '0 0 4px' }}><strong>{result.summary.headline}</strong></p>}
      {result.summary?.nextStep && <p style={{ margin: '0 0 10px', color: 'var(--text-300)' }}>{result.summary.nextStep}</p>}

      {result.stderr && <pre className="mono exec-stderr" style={{ marginBottom: 10 }}>{result.stderr}</pre>}

      {result.tests.map((t) => (
        <Card key={t.index} style={{ marginBottom: 10, padding: 12 }}>
          <p style={{ margin: '0 0 6px' }}>
            <span className="badge" style={{ borderColor: t.passed ? 'var(--success)' : 'var(--danger)', color: t.passed ? 'var(--success)' : 'var(--danger)' }}>
              Sample {t.index}: {t.passed ? 'Passed' : t.ran ? 'Failed' : 'Not run'}
            </span>
            {t.durationMs != null && <span style={{ color: 'var(--text-500)', fontSize: '0.78rem', marginLeft: 8 }}>{t.durationMs} ms</span>}
          </p>
          {!t.passed && (
            <>
              <p style={{ margin: '0 0 8px', color: 'var(--text-300)' }}>{t.explanation.message}</p>
              <div className="run-io-grid">
                <div><h5 style={{ margin: '0 0 4px' }}>Input</h5><pre className="mono" style={mono}>{t.input || '(empty)'}</pre></div>
                <div><h5 style={{ margin: '0 0 4px' }}>Expected</h5><pre className="mono" style={mono}>{t.expectedOutput}</pre></div>
                <div><h5 style={{ margin: '0 0 4px' }}>Your output</h5><pre className="mono" style={mono}>{t.actualOutput == null ? '(none captured)' : (t.actualOutput === '' ? '(empty)' : t.actualOutput)}</pre></div>
              </div>
              {t.explanation.diff && t.explanation.diff.rows.length > 1 && (
                <div className="scroll-x"><table style={{ marginTop: 8, fontSize: '0.78rem', width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th align="left">Line</th><th align="left">Expected</th><th align="left">Yours</th></tr></thead>
                  <tbody>
                    {t.explanation.diff.rows.map((r) => (
                      <tr key={r.line} style={{ color: r.match ? 'var(--text-500)' : 'var(--danger)' }}>
                        <td>{r.line}</td><td className="mono">{r.expected ?? '—'}</td><td className="mono">{r.actual ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </>
          )}
        </Card>
      ))}
      <p style={{ margin: 0, color: 'var(--text-500)', fontSize: '0.78rem' }}>
        Memory use is not measured. Hidden tests only run when you press Submit Code.
      </p>
    </div>
  )
}
