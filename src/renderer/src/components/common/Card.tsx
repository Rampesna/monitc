import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  hoverable?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({ children, className = '', style, onClick, hoverable = false, padding = 'md' }: CardProps): React.ReactElement {
  const padMap = { none: '', sm: 'p-3.5', md: 'p-5', lg: 'p-6' }
  return (
    <div
      className={`mon-card ${padMap[padding]} ${hoverable ? 'mon-card-hover cursor-pointer' : ''} ${className}`}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
