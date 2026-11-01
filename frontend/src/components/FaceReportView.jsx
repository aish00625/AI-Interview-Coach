import Panel from './Panel.jsx'
import FaceMetricCards from './FaceMetricCards.jsx'
import FaceEventTimeline from './FaceEventTimeline.jsx'
import { formatDuration, formatClock, reviewSummary, eventTitle } from '../utils/faceMonitor.js'

function Intervals({ title, items }) {
  if (!items || !items.length) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <strong>{title}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {items.map((i, n) => <li key={`${i.startedAt}-${n}`}>{formatClock(i.startedAt)} – {formatClock(i.endedAt)} ({formatDuration(i.durationMs)})</li>)}
      </ul>
    </div>
  )
}

/** The end-of-session report. It is separate from the interview score and says so. */
export default function FaceReportView({ report, events, session }) {
  if (!report) return null
  const iv = report.intervals || {}
  const anyIntervals = ['faceAbsent', 'multipleFaces', 'headDeviation', 'gazeDeviation'].some((k) => (iv[k] || []).length)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel title="Session summary">
        <p style={{ margin: 0 }}>
          Monitored for <strong>{formatDuration(report.monitoredMs)}</strong>
          {report.pausedMs ? <> (paused {formatDuration(report.pausedMs)})</> : null}; {report.framesAnalysed} frames analysed, {report.validFrames} usable.
          {session && session.retentionUntil ? <> Kept until {new Date(session.retentionUntil).toLocaleDateString()}, or until you delete it.</> : null}
        </p>
        <p style={{ margin: '8px 0 0' }}>{reviewSummary(report)}</p>
        {(report.reviewRecommendations || []).length > 0 && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {report.reviewRecommendations.map((r) => <li key={r.id}><strong>{eventTitle(`review_${r.id}`)}.</strong> {r.explanation}</li>)}
          </ul>
        )}
      </Panel>
      <FaceMetricCards cards={report.cards} />
      {anyIntervals && (
        <Panel title="Time intervals">
          <Intervals title="No face in view" items={iv.faceAbsent} />
          <Intervals title="More than one face" items={iv.multipleFaces} />
          <Intervals title="Head turned or tilted" items={iv.headDeviation} />
          <Intervals title="Eyes off to one side" items={iv.gazeDeviation} />
        </Panel>
      )}
      <Panel title="Event timeline"><FaceEventTimeline events={events} /></Panel>
      {(report.limitations || []).length > 0 && (
        <Panel title="Limits of this report">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{report.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </Panel>
      )}
      <div className="notice" role="note">
        {(report.notices || []).map((n) => <p key={n} style={{ margin: '0 0 6px' }}>{n}</p>)}
        <p style={{ margin: 0 }}>Experimental. These measurements are not part of your interview or coding scores, and they do not judge honesty, emotion or attention.</p>
      </div>
    </div>
  )
}
