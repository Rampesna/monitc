import React from 'react'
import {
  AreaChart as RechartsArea,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'

interface DataSeries {
  key: string
  label: string
  color: string
}

interface AreaChartProps {
  data: Record<string, unknown>[]
  series: DataSeries[]
  xKey?: string
  xFormatter?: (value: unknown) => string
  yFormatter?: (value: unknown) => string
  yDomain?: [number, number]
  height?: number
  className?: string
}

export function AreaChart({
  data,
  series,
  xKey = 'timestamp',
  xFormatter,
  yFormatter,
  yDomain = [0, 100],
  height = 200,
  className = ''
}: AreaChartProps): React.ReactElement {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsArea data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: '#475569', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={xFormatter}
          />
          <YAxis
            tick={{ fill: '#475569', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            domain={yDomain}
            tickFormatter={yFormatter}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2d2d45', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#94a3b8' }}
            itemStyle={{ color: '#e2e8f0' }}
            formatter={yFormatter ? (val: unknown) => [yFormatter(val), ''] : undefined}
            labelFormatter={xFormatter}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </RechartsArea>
      </ResponsiveContainer>
    </div>
  )
}
