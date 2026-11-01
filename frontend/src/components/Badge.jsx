/** Small status pill. tone: neutral | success | warning | danger | info | violet | muted. */
export default function Badge({ tone = 'neutral', children, title }) {
  const toneClass = tone === 'neutral' ? '' : `badge-${tone}`
  return <span className={`badge ${toneClass}`} title={title}>{children}</span>
}
