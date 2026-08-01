import { useId, useMemo, useState, type PointerEvent } from 'react'
import type { SystemMetricPoint } from '@monitc/shared'

const WIDTH = 1000
const HEIGHT = 240
const PAD_X = 14
const PAD_Y = 16

export function MetricChart({ points, detailed = false }: { points: SystemMetricPoint[]; detailed?: boolean }) {
  const gradientId = useId().replaceAll(':', '')
  const [hovered, setHovered] = useState<number | null>(null)
  const normalized = useMemo(() => downsample(points, detailed ? 180 : 100), [points, detailed])
  const geometry = useMemo(() => {
    const cpu = line(normalized.map((point) => point.cpuPercent))
    const memory = line(normalized.map((point) => point.memoryPercent))
    return { cpu, memory, area: cpu ? `${cpu} L ${WIDTH - PAD_X},${HEIGHT - PAD_Y} L ${PAD_X},${HEIGHT - PAD_Y} Z` : '' }
  }, [normalized])
  const activeIndex = hovered === null ? normalized.length - 1 : hovered
  const active = normalized[activeIndex]
  const x = pointX(activeIndex, normalized.length)

  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!normalized.length) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    setHovered(Math.round(ratio * (normalized.length - 1)))
  }

  return (
    <div className="metric-chart" onPointerLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="CPU and memory usage over time" onPointerMove={move}>
        <defs>
          <linearGradient id={`${gradientId}-cpu`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8b7cff" stopOpacity=".3" />
            <stop offset="1" stopColor="#8b7cff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((value) => {
          const y = PAD_Y + (100 - value) / 100 * (HEIGHT - PAD_Y * 2)
          return <line key={value} className="chart-grid-line" x1={PAD_X} x2={WIDTH - PAD_X} y1={y} y2={y} />
        })}
        {geometry.area && <path d={geometry.area} fill={`url(#${gradientId}-cpu)`} />}
        {geometry.cpu && <path className="chart-line cpu" d={geometry.cpu} />}
        {geometry.memory && <path className="chart-line memory" d={geometry.memory} />}
        {active && <>
          <line className="chart-cursor" x1={x} x2={x} y1={PAD_Y} y2={HEIGHT - PAD_Y} />
          <circle className="chart-point cpu" cx={x} cy={pointY(active.cpuPercent)} r="4" />
          <circle className="chart-point memory" cx={x} cy={pointY(active.memoryPercent)} r="4" />
        </>}
      </svg>
      {active && hovered !== null && <div className={`metric-tooltip ${x > WIDTH * .7 ? 'left' : ''}`} style={{ left: `${x / WIDTH * 100}%` }}>
        <time>{new Date(active.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: detailed ? '2-digit' : undefined })}</time>
        <span><i className="purple" /> CPU <strong>{active.cpuPercent.toFixed(1)}%</strong></span>
        <span><i className="cyan" /> Memory <strong>{active.memoryPercent.toFixed(1)}%</strong></span>
      </div>}
      <div className="chart-axis-labels"><span>{normalized[0] ? new Date(normalized[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span><span>50%</span><span>{normalized.at(-1) ? 'now' : ''}</span></div>
    </div>
  )
}

function pointX(index: number, length: number): number {
  return length <= 1 ? PAD_X : PAD_X + index / (length - 1) * (WIDTH - PAD_X * 2)
}

function pointY(value: number): number {
  const bounded = Math.max(0, Math.min(100, value))
  return PAD_Y + (100 - bounded) / 100 * (HEIGHT - PAD_Y * 2)
}

function line(values: number[]): string {
  if (!values.length) return ''
  return values.map((value, index) => `${index ? 'L' : 'M'} ${pointX(index, values.length).toFixed(1)},${pointY(value).toFixed(1)}`).join(' ')
}

function downsample<T>(values: T[], target: number): T[] {
  if (values.length <= target) return values
  const step = (values.length - 1) / (target - 1)
  return Array.from({ length: target }, (_, index) => values[Math.round(index * step)]!).filter(Boolean)
}
