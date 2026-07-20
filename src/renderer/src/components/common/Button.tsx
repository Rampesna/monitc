import React from 'react'
import { Spinner } from './Spinner'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'mon-button-primary',
  secondary: 'mon-button-secondary',
  danger: 'mon-button-danger',
  ghost: 'mon-button-ghost',
  success: 'mon-button-success'
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2 gap-2',
  lg: 'text-base px-5 py-2.5 gap-2.5'
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, children, disabled, className = '', ...props }: ButtonProps): React.ReactElement {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`mon-button inline-flex items-center justify-center font-medium disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  )
}
