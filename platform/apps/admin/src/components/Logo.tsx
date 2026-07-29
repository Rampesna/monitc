export function Logo({ compact = false }: { compact?: boolean }) {
  return <span className={`admin-logo ${compact ? 'compact' : ''}`}><i><b /></i>{!compact && <span>monitc <small>ops</small></span>}</span>
}
