/** Loading placeholder block. Decorative: screen readers get the surrounding region's aria-busy / label instead. */
export function Skeleton({ height = 16, width = '100%', style = {} }) {
  return <div className="skeleton" aria-hidden="true" style={{ height, width, ...style }} />
}

/** Layout-shaped placeholder for a card-grid dashboard. */
export function DashboardSkeleton({ label = 'Loading' }) {
  return (
    <div className="stack" role="status" aria-busy="true" aria-label={label}>
      <Skeleton height={34} width="40%" />
      <div className="grid grid-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} style={{ borderRadius: 12 }} />)}
      </div>
      <div className="grid grid-main-side">
        <Skeleton height={260} style={{ borderRadius: 12 }} />
        <Skeleton height={260} style={{ borderRadius: 12 }} />
      </div>
      <Skeleton height={180} style={{ borderRadius: 12 }} />
    </div>
  )
}

export default Skeleton
