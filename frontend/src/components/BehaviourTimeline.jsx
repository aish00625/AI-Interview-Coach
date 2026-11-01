import { timelineView } from '../utils/resultsView.js'

const W = 560
const H = 150
const PAD = { l: 8, r: 8, t: 8, b: 22 }

/**
 * "Throughout the answer": one line per measured signal across the answer. Lines break where a frame could not be measured. The
 * chart is a plain SVG with a text equivalent below it, so it can be read without sight of the colours.
 */
export default function BehaviourTimeline({ cv }) {
  const view = timelineView(cv)
  if (!view) return <p className="small" style={{ margin: 0, color: 'var(--text-500)' }}>No timeline is available for this answer (too few frames were measured).</p>
  const x = (v) => PAD.l + v * (W - PAD.l - PAD.r)
  const y = (v) => H - PAD.b - v * (H - PAD.t - PAD.b)
  const path = (seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ')
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Timeline of face visibility, facing the camera, facial change and head change across the answer" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[0, 0.5, 1].map((g) => <line key={g} x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--border-500)" strokeWidth="1" />)}
        {view.series.map((s) => s.segments.map((seg, i) => (
          seg.length === 1
            ? <circle key={`${s.key}${i}`} cx={x(seg[0].x)} cy={y(seg[0].y)} r="3" fill={s.color} />
            : <path key={`${s.key}${i}`} d={path(seg)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )))}
        {view.ticks.map((t) => <text key={t.label} x={x(t.x)} y={H - 6} fontSize="11" fill="var(--text-500)" textAnchor={t.x === 0 ? 'start' : t.x === 1 ? 'end' : 'middle'}>{t.label}</text>)}
      </svg>
      <figcaption style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-300)', marginTop: 4 }}>
        {view.series.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 12, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
      </figcaption>
      <p className="small" style={{ margin: '6px 0 0', color: 'var(--text-500)' }}>
        Face visible and Facing camera are on/off (top = yes). Facial change and Head change show how much changed since the previous sampled frame. Gaps mean that moment could not be measured.
      </p>
    </figure>
  )
}
