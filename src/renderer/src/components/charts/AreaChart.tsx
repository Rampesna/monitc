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
                <stop offset="5%" stopColor={s.color} stopOpacity={0.18} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,.045)" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: '#5f5f6b', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={xFormatter}
          />
          <YAxis
            tick={{ fill: '#5f5f6b', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={yDomain}
            tickFormatter={yFormatter}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#15151e', border: '1px solid rgba(255,255,255,.09)', borderRadius: 10, fontSize: 11, boxShadow: '0 14px 34px rgba(0,0,0,.32)' }}
            labelStyle={{ color: '#777783' }}
            itemStyle={{ color: '#d9d9df' }}
            formatter={yFormatter ? (val: unknown) => [yFormatter(val), ''] : undefined}
            labelFormatter={xFormatter}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: '#777783', paddingTop: 4 }} iconType="circle" iconSize={6} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2.5}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: s.color }}
            />
          ))}
        </RechartsArea>
      </ResponsiveContainer>
    </div>
  )
}
