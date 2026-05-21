import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import type { Server, SystemMetrics, DockerData, KubernetesData, ConnectionStatus, TriggeredAlert, AppPreferences } from '../lib/types'

interface AppState {
  servers: Server[]
  selectedServerId: string | null
  connectionStatuses: Record<string, ConnectionStatus['status']>
  metricsHistory: Record<string, SystemMetrics[]>
  dockerData: Record<string, DockerData>
  kubernetesData: Record<string, KubernetesData>
  preferences: AppPreferences
  recentAlerts: TriggeredAlert[]
  licenseKey: string
  licenseIsNew: boolean
  isLoading: boolean
}

type Action =
  | { type: 'SET_SERVERS'; servers: Server[] }
  | { type: 'SELECT_SERVER'; serverId: string | null }
  | { type: 'SET_CONNECTION'; serverId: string; status: ConnectionStatus['status'] }
  | { type: 'ADD_METRICS'; metrics: SystemMetrics }
  | { type: 'SET_DOCKER'; data: DockerData }
  | { type: 'SET_KUBERNETES'; data: KubernetesData }
  | { type: 'SET_PREFERENCES'; prefs: AppPreferences }
  | { type: 'ADD_ALERT'; alert: TriggeredAlert }
  | { type: 'SET_LICENSE'; key: string; isNew: boolean }
  | { type: 'SET_LOADING'; loading: boolean }

const MAX_HISTORY = 120

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SERVERS':
      return { ...state, servers: action.servers }
    case 'SELECT_SERVER':
      return { ...state, selectedServerId: action.serverId }
    case 'SET_CONNECTION':
      return { ...state, connectionStatuses: { ...state.connectionStatuses, [action.serverId]: action.status } }
    case 'ADD_METRICS': {
      const history = state.metricsHistory[action.metrics.serverId] || []
      const updated = [...history, action.metrics].slice(-MAX_HISTORY)
      return { ...state, metricsHistory: { ...state.metricsHistory, [action.metrics.serverId]: updated } }
    }
    case 'SET_DOCKER':
      return { ...state, dockerData: { ...state.dockerData, [action.data.serverId]: action.data } }
    case 'SET_KUBERNETES':
      return { ...state, kubernetesData: { ...state.kubernetesData, [action.data.serverId]: action.data } }
    case 'SET_PREFERENCES':
      return { ...state, preferences: action.prefs }
    case 'ADD_ALERT':
      return { ...state, recentAlerts: [action.alert, ...state.recentAlerts].slice(0, 50) }
    case 'SET_LICENSE':
      return { ...state, licenseKey: action.key, licenseIsNew: action.isNew }
    case 'SET_LOADING':
      return { ...state, isLoading: action.loading }
    default:
      return state
  }
}

const initialState: AppState = {
  servers: [],
  selectedServerId: null,
  connectionStatuses: {},
  metricsHistory: {},
  dockerData: {},
  kubernetesData: {},
  preferences: {
    theme: 'dark',
    pollIntervals: { system: 5, docker: 10, kubernetes: 10 },
    sidebarCollapsed: false
  },
  recentAlerts: [],
  licenseKey: '',
  licenseIsNew: false,
  isLoading: true
}

interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
  refreshServers: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState)

  const refreshServers = useCallback(async () => {
    const servers = await window.monitcAPI.servers.list() as Server[]
    dispatch({ type: 'SET_SERVERS', servers })
  }, [])

  useEffect(() => {
    const init = async (): Promise<void> => {
      const [licenseKey, servers, prefs] = await Promise.all([
        window.monitcAPI.app.getLicenseKey(),
        window.monitcAPI.servers.list() as Promise<Server[]>,
        window.monitcAPI.preferences.get() as Promise<AppPreferences>
      ])
      dispatch({ type: 'SET_LICENSE', key: licenseKey, isNew: false })
      dispatch({ type: 'SET_SERVERS', servers })
      dispatch({ type: 'SET_PREFERENCES', prefs })
      dispatch({ type: 'SET_LOADING', loading: false })
      if (prefs.language) {
        import('../i18n').then(({ applyLanguage }) => applyLanguage(prefs.language!)).catch(console.error)
      }

      for (const server of servers) {
        window.monitcAPI.monitor.start(server.id).catch(console.error)
      }
    }
    init().catch(console.error)

    const offMetrics = window.monitcAPI.monitor.onMetricsUpdate((data) => {
      dispatch({ type: 'ADD_METRICS', metrics: data as SystemMetrics })
    })
    const offConn = window.monitcAPI.monitor.onConnectionStatus((data) => {
      const s = data as ConnectionStatus
      dispatch({ type: 'SET_CONNECTION', serverId: s.serverId, status: s.status })
    })
    const offDocker = window.monitcAPI.docker.onUpdate((data) => {
      dispatch({ type: 'SET_DOCKER', data: data as DockerData })
    })
    const offK8s = window.monitcAPI.kubernetes.onUpdate((data) => {
      dispatch({ type: 'SET_KUBERNETES', data: data as KubernetesData })
    })
    const offAlert = window.monitcAPI.alerts.onTriggered((data) => {
      dispatch({ type: 'ADD_ALERT', alert: data as TriggeredAlert })
    })

    return () => {
      offMetrics()
      offConn()
      offDocker()
      offK8s()
      offAlert()
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const theme = state.preferences.theme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
    root.classList.toggle('dark', isDark)
    root.classList.toggle('light', !isDark)
  }, [state.preferences.theme])

  return <AppContext.Provider value={{ state, dispatch, refreshServers }}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
