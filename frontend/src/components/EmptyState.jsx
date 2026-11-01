export default function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <h3 style={{ marginBottom: 6 }}>{title}</h3>
      {description && <p style={{ margin: '0 auto 16px', color: 'var(--text-500)' }}>{description}</p>}
      {action}
    </div>
  )
}
