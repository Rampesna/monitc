import React from 'react'
import {
  BarChart as RechartsBar,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'

interface BarChartProps {
  data: Record<string, unknown>[]
  dataKey: string
  xKey?: string
  color?: string
  height?: number
  yFormatter?: (value: unknown) => string
  className?: string
}

export function BarChart({ data, dataKey, xKey = 'name', color = '#6366f1', height = 160, yFormatter, className = '' }: BarChartProps): React.ReactElement {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBar data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: '#475569', fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: '#475569', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={yFormatter} />
          <Tooltip
            contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2d2d45', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
        </RechartsBar>
      </ResponsiveContainer>
    </div>
  )
}
