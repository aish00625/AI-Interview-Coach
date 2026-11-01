/** session: { id, type, targetRole, difficulty, date, finalScore, status } */
export default function InterviewCard({ session }) {
  return (
    <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{session.type} · {session.targetRole}</div>
        <div style={{ color: 'var(--text-500)', fontSize: '0.85rem', marginTop: 4 }}>
          {session.date} · <span className={`badge badge-${session.difficulty}`}>{session.difficulty}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="mono" style={{ fontSize: '1.3rem', color: session.finalScore ? 'var(--accent-amber)' : 'var(--text-500)' }}>
          {session.finalScore ?? '—'}
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-500)', textTransform: 'capitalize' }}>{session.status}</div>
      </div>
    </div>
  )
}
