/** Big-number score display used on Dashboard, Progress, and Results pages. */
export default function ScoreCard({ label, value, suffix = '/ 100' }) {
  return (
    <div className="card" style={{ textAlign: 'left' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', color: 'var(--accent-amber)', lineHeight: 1 }}>
        {value}
        <span style={{ fontSize: '1rem', color: 'var(--text-500)' }}> {suffix}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-500)' }}>{label}</div>
    </div>
  )
}
