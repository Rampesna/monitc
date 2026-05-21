import React from 'react'

interface MetricGaugeProps {
  value: number
  max?: number
  label: string
  unit?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function getColor(value: number, max: number): string {
  const pct = (value / max) * 100
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#6366f1'
}

export function MetricGauge({ value, max = 100, label, unit = '%', size = 'md', className = '' }: MetricGaugeProps): React.ReactElement {
  const pct = Math.min(100, (value / max) * 100)
  const sizePx = size === 'sm' ? 64 : size === 'md' ? 80 : 100
  const strokeWidth = size === 'sm' ? 6 : 7
  const radius = (sizePx - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (pct / 100) * circumference * 0.75
  const gap = circumference * 0.75 - dash
  const rotation = -225
  const color = getColor(value, max)
  const fontSize = size === 'sm' ? 'text-lg' : size === 'md' ? 'text-xl' : 'text-2xl'

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <div className="relative" style={{ width: sizePx, height: sizePx }}>
        <svg width={sizePx} height={sizePx} viewBox={`0 0 ${sizePx} ${sizePx}`} className="overflow-visible">
          <circle
            cx={sizePx / 2}
            cy={sizePx / 2}
            r={radius}
            fill="none"
            stroke="#1e1e2e"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            transform={`rotate(${rotation} ${sizePx / 2} ${sizePx / 2})`}
          />
          <circle
            cx={sizePx / 2}
            cy={sizePx / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap + circumference * 0.25}`}
            transform={`rotate(${rotation} ${sizePx / 2} ${sizePx / 2})`}
            style={{ transition: 'stroke-dasharray 0.4s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold ${fontSize}`} style={{ color }}>
            {Math.round(value)}
          </span>
          <span className="text-xs text-slate-400">{unit}</span>
        </div>
      </div>
      <span className="text-xs text-slate-400 font-medium">{label}</span>
    </div>
  )
}
