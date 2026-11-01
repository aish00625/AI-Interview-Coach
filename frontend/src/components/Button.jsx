export default function Button({ children, variant = 'primary', block = false, size = 'md', className = '', ...props }) {
  const variantClass = variant === 'secondary' ? 'btn-secondary' : variant === 'danger' ? 'btn-danger' : 'btn-primary'
  return (
    <button className={`btn ${variantClass} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`} {...props}>
      {children}
    </button>
  )
}
