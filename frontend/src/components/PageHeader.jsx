/** Consistent page title block: title, optional one-line description, and an actions slot (buttons/links) on the right. */
export default function PageHeader({ title, description, actions = null }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}
