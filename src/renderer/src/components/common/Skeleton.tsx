import React from 'react'

interface SkeletonProps {
  className?: string
  rounded?: 'sm' | 'md' | 'lg' | 'full'
}

export function Skeleton({ className = '', rounded = 'md' }: SkeletonProps): React.ReactElement {
  return <span aria-hidden="true" className={`mon-skeleton mon-skeleton-${rounded} ${className}`} />
}

export function GaugeSkeleton(): React.ReactElement {
  return (
    <div className="gauge-skeleton" aria-hidden="true">
      <Skeleton rounded="full" />
      <div><Skeleton className="w-8 h-3" /><Skeleton className="w-10 h-2" /></div>
    </div>
  )
}

export function RowSkeleton({ compact = false }: { compact?: boolean }): React.ReactElement {
  return (
    <div className={`row-skeleton ${compact ? 'is-compact' : ''}`} aria-hidden="true">
      <Skeleton rounded="lg" className="row-skeleton-icon" />
      <div className="row-skeleton-copy">
        <Skeleton className="w-[38%] h-2.5" />
        <Skeleton className="w-[62%] h-2" />
      </div>
      <Skeleton rounded="full" className="w-2 h-2" />
    </div>
  )
}
