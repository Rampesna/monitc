import React from 'react'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = { sm: 'w-3 h-3', md: 'w-5 h-5', lg: 'w-8 h-8' }

export function Spinner({ size = 'md', className = '' }: SpinnerProps): React.ReactElement {
  return (
    <div className={`${sizeClasses[size]} ${className} animate-spin rounded-full border-2 border-current border-t-transparent opacity-80`} />
  )
}
