export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />
}

export function PageSkeleton() {
  return (
    <div className="page page-skeleton">
      <div className="page-title">
        <div><Skeleton className="sk-eyebrow" /><Skeleton className="sk-title" /></div>
        <Skeleton className="sk-button" />
      </div>
      <div className="stat-grid">
        {[0, 1, 2, 3].map((value) => <Skeleton className="sk-stat" key={value} />)}
      </div>
      <Skeleton className="sk-panel" />
    </div>
  )
}
