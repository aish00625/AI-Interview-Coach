// Shared chart colours (CSS variables resolve inside SVG attributes in modern browsers). One place so charts agree.
export const CHART = {
  grid: 'var(--border-500)',
  axis: 'var(--text-500)',
  primary: '#7C83FF',   // indigo
  secondary: '#A78BFA', // violet
  accent: '#F2B84B',    // amber
  good: '#6FCF97',
  bad: '#F2555A',
  neutral: '#384252',
}
export const axisProps = { stroke: CHART.axis, fontSize: 12, tickLine: false }
