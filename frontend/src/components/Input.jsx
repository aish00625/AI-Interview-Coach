export default function Input({ label, error, id, ...props }) {
  const inputId = id || props.name
  return (
    <div className="field">
      {label && <label htmlFor={inputId}>{label}</label>}
      <input id={inputId} className="input" {...props} />
      {error && <div className="field-error">{error}</div>}
    </div>
  )
}
