import { useState, useCallback } from 'react'

export interface MetricsHistoryState {
  data: MetricsHistoryPoint[]
  loading: boolean
  error: string | null
}

export function useMetricsHistory(): {
  fetch: (serverId: string, hours: number) => Promise<MetricsHistoryPoint[]>
  state: MetricsHistoryState
} {
  const [state, setState] = useState<MetricsHistoryState>({ data: [], loading: false, error: null })

  const fetch = useCallback(async (serverId: string, hours: number): Promise<MetricsHistoryPoint[]> => {
    setState({ data: [], loading: true, error: null })
    try {
      const data = await window.monitcAPI.monitor.getHistory(serverId, hours)
      setState({ data, loading: false, error: null })
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState({ data: [], loading: false, error: msg })
      return []
    }
  }, [])

  return { fetch, state }
}
