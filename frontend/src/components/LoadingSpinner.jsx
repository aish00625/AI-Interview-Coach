export default function LoadingSpinner({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-500)' }}>
      <span className="spinner" />
      {label && <span>{label}</span>}
    </div>
  )
}
