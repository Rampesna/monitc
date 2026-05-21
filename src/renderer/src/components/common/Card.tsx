import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({ children, className = '', onClick, hoverable = false, padding = 'md' }: CardProps): React.ReactElement {
  const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }
  return (
    <div
      className={`bg-[#12121a] border border-[#1e1e2e] rounded-xl ${padMap[padding]} ${hoverable ? 'cursor-pointer hover:bg-[#1a1a25] hover:border-[#2d2d45] transition-all duration-200' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
