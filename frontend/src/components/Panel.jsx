import { Link } from 'react-router-dom'

/** Titled content block. `to`/`linkLabel` add a "view more" link in the header; `hero` gives it the accent background. */
export default function Panel({ title, to, linkLabel = 'View all', hero = false, aside = null, children, className = '', ...rest }) {
  return (
    <section className={`panel ${hero ? 'panel-hero' : ''} ${className}`} {...rest}>
      {(title || to || aside) && (
        <div className="panel-header">
          {title && <h2 className="panel-title">{title}</h2>}
          {aside}
          {to && <Link to={to} className="panel-link">{linkLabel}</Link>}
        </div>
      )}
      {children}
    </section>
  )
}
