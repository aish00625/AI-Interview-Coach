/** Recharts tooltip content styled to the design system. Pass as <Tooltip content={<ChartTooltip unit="%" />} />. */
export default function ChartTooltip({ active, payload, label, unit = '', labelFormatter }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div style={{ background: 'var(--ink-900)', border: '1px solid var(--border-400)', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem', boxShadow: 'var(--shadow-panel)' }}>
      <div style={{ color: 'var(--text-500)', marginBottom: 4 }}>{labelFormatter ? labelFormatter(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey || p.name} style={{ color: p.color || 'var(--text-100)' }}>
          {p.name}: <strong>{p.value == null ? '—' : p.value}{p.value == null ? '' : unit}</strong>
        </div>
      ))}
    </div>
  )
}
