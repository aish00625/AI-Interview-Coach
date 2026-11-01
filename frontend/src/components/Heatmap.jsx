/**
 * Daily practice heatmap built from REAL per-day action counts (days with none are genuine zeros).
 * cells: [{ date: 'YYYY-MM-DD', count, level 0-4 }] oldest first. Weeks run in columns; the first column is padded so
 * rows line up with Monday-Sunday. Colour is never the only signal: every cell has a text title and the totals are shown.
 */
export default function Heatmap({ cells, totalActions, activeDays }) {
  if (!cells || !cells.length) return null
  const first = new Date(`${cells[0].date}T00:00:00Z`)
  const pad = (first.getUTCDay() + 6) % 7 // Monday = 0
  return (
    <div>
      <div className="heatmap" role="img" aria-label={`Practice activity over the last ${cells.length} days: ${totalActions} actions on ${activeDays} days.`}>
        {Array.from({ length: pad }).map((_, i) => <span key={`p${i}`} style={{ width: 13, height: 13 }} />)}
        {cells.map((c) => (
          <span key={c.date} className={`heat-cell ${c.level ? `heat-${c.level}` : ''}`} title={`${c.date}: ${c.count} action${c.count === 1 ? '' : 's'}`} />
        ))}
      </div>
      <div className="row-between" style={{ marginTop: 8 }}>
        <span className="small muted">{totalActions} action{totalActions === 1 ? '' : 's'} on {activeDays} day{activeDays === 1 ? '' : 's'} in the last {cells.length} days</span>
        <span className="heat-legend" aria-hidden="true">Less <span className="heat-cell" /><span className="heat-cell heat-1" /><span className="heat-cell heat-2" /><span className="heat-cell heat-3" /><span className="heat-cell heat-4" /> More</span>
      </div>
    </div>
  )
}
