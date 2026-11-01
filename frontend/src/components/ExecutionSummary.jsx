import { describeRun, describeSubmission } from '../utils/codingStatus.js'

const TONE_CLASS = { success: 'badge-success', warning: 'badge-warning', danger: 'badge-danger', muted: 'badge-muted' }

/**
 * Headline for a Run Code or Submit Code result: the status label, passed / failed / total counts, execution time and a one-line
 * explanation. Pass either `submission` (Submit Code) or `run` (Run Code). Counts and time are shown only when the response has them.
 */
export default function ExecutionSummary({ submission, run }) {
  const d = submission ? describeSubmission(submission) : describeRun(run)
  if (!d) return null
  const hasCounts = d.total !== null && d.total > 0 && d.passed !== null
  return (
    <div className="exec-summary" role="status" aria-live="polite">
      <div className="exec-summary-head">
        <span className={`badge exec-badge ${TONE_CLASS[d.tone] || ''}`}>{d.label}</span>
        {hasCounts && (
          <span className="exec-counts">
            <span><strong>{d.passed}</strong> passed</span>
            <span><strong>{d.failed}</strong> failed</span>
            <span><strong>{d.total}</strong> total</span>
          </span>
        )}
        {d.timeMs !== null && <span className="small muted">{d.timeMs} ms{run ? ' (includes container start-up)' : ''}</span>}
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>{d.explanation}</p>
    </div>
  )
}
