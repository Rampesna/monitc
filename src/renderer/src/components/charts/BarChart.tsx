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
          <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,.045)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: '#5f5f6b', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: '#5f5f6b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={yFormatter} />
          <Tooltip
            contentStyle={{ backgroundColor: '#15151e', border: '1px solid rgba(255,255,255,.09)', borderRadius: 10, fontSize: 11, boxShadow: '0 14px 34px rgba(0,0,0,.32)' }}
            labelStyle={{ color: '#777783' }}
          />
          <Bar dataKey={dataKey} fill={color} radius={[5, 5, 1, 1]} />
        </RechartsBar>
      </ResponsiveContainer>
    </div>
  )
}
