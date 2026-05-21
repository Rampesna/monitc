import React from 'react'
import type { ConnectionState } from '../../lib/types'

interface StatusDotProps {
  status: ConnectionState
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

const colorMap: Record<ConnectionState, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-amber-400 animate-pulse-dot',
  disconnected: 'bg-slate-500',
  error: 'bg-red-500'
}

const labelMap: Record<ConnectionState, string> = {
  connected: 'Bağlı',
  connecting: 'Bağlanıyor...',
  disconnected: 'Bağlı Değil',
  error: 'Hata'
}

const sizeMap = { sm: 'w-2 h-2', md: 'w-2.5 h-2.5', lg: 'w-3 h-3' }
const textMap: Record<ConnectionState, string> = {
  connected: 'text-green-400',
  connecting: 'text-amber-400',
  disconnected: 'text-slate-400',
  error: 'text-red-400'
}

export function StatusDot({ status, size = 'md', showLabel = false, className = '' }: StatusDotProps): React.ReactElement {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`rounded-full ${sizeMap[size]} ${colorMap[status]} flex-shrink-0`} />
      {showLabel && (
        <span className={`text-xs ${textMap[status]}`}>{labelMap[status]}</span>
      )}
    </span>
  )
}
