import React from 'react'

interface MetricGaugeProps {
  value: number
  max?: number
  label: string
  unit?: string
  size?: 'sm' | 'md' | 'lg'
  tone?: 'purple' | 'cyan' | 'green'
  className?: string
}

function getColor(value: number, max: number, tone: MetricGaugeProps['tone']): string {
  const pct = (value / max) * 100
  if (pct >= 90) return '#ef4444'
  if (pct >= 78) return '#f2b86b'
  if (tone === 'cyan') return '#42d5e8'
  if (tone === 'green') return '#5ce3a3'
  return '#806bff'
}

export function MetricGauge({
  value,
  max = 100,
  label,
  unit = '%',
  size = 'md',
  tone = 'purple',
  className = ''
}: MetricGaugeProps): React.ReactElement {
  const pct = Math.min(100, (value / max) * 100)
  const sizePx = size === 'sm' ? 62 : size === 'md' ? 82 : 108
  const strokeWidth = size === 'sm' ? 6 : size === 'md' ? 7 : 8
  const radius = (sizePx - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (pct / 100) * circumference
  const color = getColor(value, max, tone)
  const fontSize = size === 'sm' ? 'text-base' : size === 'md' ? 'text-lg' : 'text-2xl'

  return (
    <div className={`metric-gauge flex flex-col items-center ${className}`}>
      <div className="relative" style={{ width: sizePx, height: sizePx }}>
        <svg width={sizePx} height={sizePx} viewBox={`0 0 ${sizePx} ${sizePx}`} className="overflow-visible">
          <circle
            cx={sizePx / 2}
            cy={sizePx / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.055)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <circle
            cx={sizePx / 2}
            cy={sizePx / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${sizePx / 2} ${sizePx / 2})`}
            style={{ transition: 'stroke-dasharray 0.45s ease, stroke 0.25s ease', filter: `drop-shadow(0 0 4px ${color}33)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-semibold leading-none text-slate-100 ${fontSize}`}>
            {Math.round(value)}<small className="ml-0.5 text-[9px] font-medium text-slate-500">{unit}</small>
          </span>
          <span className="mt-1 text-[9px] uppercase tracking-[0.08em] text-slate-500">{label}</span>
        </div>
      </div>
    </div>
  )
}
