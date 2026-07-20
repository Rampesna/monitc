import React from 'react'

interface Tab {
  id: string
  label: string
  icon?: React.ReactNode
  badge?: string | number
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps): React.ReactElement {
  return (
    <div className={`mon-tabs flex gap-1 p-1 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 no-drag ${
            active === tab.id
              ? 'mon-tab-active'
              : 'mon-tab-idle'
          }`}
        >
          {tab.icon}
          {tab.label}
          {tab.badge !== undefined && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${active === tab.id ? 'bg-white/20' : 'bg-slate-600/50 text-slate-300'}`}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
