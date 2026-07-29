export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`logo ${compact ? 'compact' : ''}`} href="/">
      <span className="logo-mark"><i /></span>
      {!compact && <span>monitc</span>}
    </a>
  )
}
