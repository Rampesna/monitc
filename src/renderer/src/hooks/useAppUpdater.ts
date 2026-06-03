import { useState, useEffect, useCallback } from 'react'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'uptodate'
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  version?: string
  percent?: number
  message?: string
  releaseNotes?: string
}

const VISIBLE_STATUSES: UpdaterStatus[] = ['available', 'downloading', 'ready', 'error']

export function useAppUpdater(): {
  state: UpdaterState
  visible: boolean
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
} {
  const [state, setState] = useState<UpdaterState>({
    status: 'idle',
    currentVersion: ''
  })

  useEffect(() => {
    window.monitcAPI.updater.getStatus().then(setState)
    return window.monitcAPI.updater.onStatus(setState)
  }, [])

  const check = useCallback(async () => {
    const next = await window.monitcAPI.updater.check()
    setState(next)
  }, [])

  const download = useCallback(async () => {
    await window.monitcAPI.updater.download()
  }, [])

  const install = useCallback(async () => {
    await window.monitcAPI.updater.install()
  }, [])

  const visible = VISIBLE_STATUSES.includes(state.status)

  return { state, visible, check, download, install }
}
