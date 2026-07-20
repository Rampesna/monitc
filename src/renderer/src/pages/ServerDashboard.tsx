import React from 'react'
import { useParams } from 'react-router-dom'
import { Dashboard } from './Dashboard'

export function ServerDashboard(): React.ReactElement {
  const { serverId } = useParams<{ serverId: string }>()
  return <Dashboard serverIdOverride={serverId} />
}
