import React from 'react'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function Switch({ checked, onChange, label, disabled = false, size = 'md' }: SwitchProps): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`mon-switch mon-switch-${size} ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="mon-switch-thumb" />
    </button>
  )
}
