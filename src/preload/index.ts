import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

contextBridge.exposeInMainWorld('electron', electronAPI)

const monitcAPI = {
  servers: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('servers:list'),
    add: (server: unknown): Promise<unknown> => ipcRenderer.invoke('servers:add', server),
    update: (server: unknown): Promise<unknown> => ipcRenderer.invoke('servers:update', server),
    remove: (serverId: string): Promise<boolean> => ipcRenderer.invoke('servers:remove', serverId),
    testConnection: (server: unknown): Promise<{ success: boolean; error?: string; latency?: number }> =>
      ipcRenderer.invoke('servers:test', server)
  },
  monitor: {
    start: (serverId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('monitor:start', serverId),
    stop: (serverId: string): Promise<boolean> => ipcRenderer.invoke('monitor:stop', serverId),
    getStatus: (serverId: string): Promise<string> => ipcRenderer.invoke('monitor:status', serverId),
    onMetricsUpdate: (cb: (metrics: unknown) => void): (() => void) => {
      const handler = (_: unknown, data: unknown): void => cb(data)
      ipcRenderer.on('metrics:update', handler)
      return () => ipcRenderer.removeListener('metrics:update', handler)
    },
    onConnectionStatus: (cb: (status: unknown) => void): (() => void) => {
      const handler = (_: unknown, data: unknown): void => cb(data)
      ipcRenderer.on('connection:status', handler)
      return () => ipcRenderer.removeListener('connection:status', handler)
    }
  },
  docker: {
    onUpdate: (cb: (data: unknown) => void): (() => void) => {
      const handler = (_: unknown, data: unknown): void => cb(data)
      ipcRenderer.on('docker:update', handler)
      return () => ipcRenderer.removeListener('docker:update', handler)
    },
    action: (serverId: string, action: string, containerId: string): Promise<unknown> =>
      ipcRenderer.invoke('docker:action', serverId, action, containerId),
    inspect: (serverId: string, containerId: string): Promise<unknown> =>
      ipcRenderer.invoke('docker:inspect', serverId, containerId)
  },
  kubernetes: {
    onUpdate: (cb: (data: unknown) => void): (() => void) => {
      const handler = (_: unknown, data: unknown): void => cb(data)
      ipcRenderer.on('kubernetes:update', handler)
      return () => ipcRenderer.removeListener('kubernetes:update', handler)
    },
    podDescribe: (serverId: string, namespace: string, pod: string): Promise<string> =>
      ipcRenderer.invoke('k8s:pod:describe', serverId, namespace, pod)
  },
  logs: {
    startDocker: (serverId: string, containerId: string, tail: number): Promise<string> =>
      ipcRenderer.invoke('logs:start:docker', serverId, containerId, tail),
    startK8s: (serverId: string, namespace: string, pod: string, container?: string): Promise<string> =>
      ipcRenderer.invoke('logs:start:k8s', serverId, namespace, pod, container),
    stop: (streamId: string): Promise<boolean> => ipcRenderer.invoke('logs:stop', streamId),
    onData: (streamId: string, cb: (data: string) => void): (() => void) => {
      const channel = `log:data:${streamId}`
      const handler = (_: unknown, data: string): void => cb(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onClose: (streamId: string, cb: () => void): (() => void) => {
      const channel = `log:close:${streamId}`
      const handler = (): void => cb()
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  alerts: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('alerts:list'),
    add: (rule: unknown): Promise<unknown> => ipcRenderer.invoke('alerts:add', rule),
    update: (rule: unknown): Promise<unknown> => ipcRenderer.invoke('alerts:update', rule),
    remove: (ruleId: string): Promise<boolean> => ipcRenderer.invoke('alerts:remove', ruleId),
    onTriggered: (cb: (alert: unknown) => void): (() => void) => {
      const handler = (_: unknown, data: unknown): void => cb(data)
      ipcRenderer.on('alert:triggered', handler)
      return () => ipcRenderer.removeListener('alert:triggered', handler)
    }
  },
  settings: {
    getIntegrations: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),
    saveIntegrations: (integrations: unknown): Promise<boolean> =>
      ipcRenderer.invoke('settings:save', integrations),
    testSmtp: (config: unknown): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:test:smtp', config),
    testWhatsApp: (config: unknown): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:test:whatsapp', config),
    testTelegram: (config: unknown): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:test:telegram', config)
  },
  preferences: {
    get: (): Promise<unknown> => ipcRenderer.invoke('preferences:get'),
    save: (prefs: unknown): Promise<boolean> => ipcRenderer.invoke('preferences:save', prefs)
  },
  app: {
    platform: process.platform,
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
    resetData: (): Promise<boolean> => ipcRenderer.invoke('app:reset'),
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close')
  },
  projects: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('projects:list'),
    add: (link: unknown): Promise<unknown> => ipcRenderer.invoke('projects:add', link),
    update: (link: unknown): Promise<unknown> => ipcRenderer.invoke('projects:update', link),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:remove', id)
  },
  k8sManage: {
    listNamespaces: (serverId: string): Promise<unknown[]> => ipcRenderer.invoke('k8s:namespaces:list', serverId),
    createNamespace: (serverId: string, name: string): Promise<unknown> => ipcRenderer.invoke('k8s:namespaces:create', serverId, name),
    deleteNamespace: (serverId: string, name: string): Promise<unknown> => ipcRenderer.invoke('k8s:namespaces:delete', serverId, name),
    listSecrets: (serverId: string, ns: string): Promise<unknown[]> => ipcRenderer.invoke('k8s:secrets:list', serverId, ns),
    createSecretGeneric: (serverId: string, name: string, ns: string, literals: Record<string, string>): Promise<unknown> =>
      ipcRenderer.invoke('k8s:secrets:create:generic', serverId, name, ns, literals),
    createSecretDockerRegistry: (serverId: string, name: string, ns: string, server: string, user: string, pass: string, email: string): Promise<unknown> =>
      ipcRenderer.invoke('k8s:secrets:create:dockerregistry', serverId, name, ns, server, user, pass, email),
    deleteSecret: (serverId: string, name: string, ns: string): Promise<unknown> => ipcRenderer.invoke('k8s:secrets:delete', serverId, name, ns),
    listServiceAccounts: (serverId: string, ns: string): Promise<unknown[]> => ipcRenderer.invoke('k8s:serviceaccounts:list', serverId, ns),
    createServiceAccount: (serverId: string, name: string, ns: string): Promise<unknown> => ipcRenderer.invoke('k8s:serviceaccounts:create', serverId, name, ns),
    getKubeconfig: (serverId: string): Promise<unknown> => ipcRenderer.invoke('k8s:kubeconfig:get', serverId),
    getCICDKubeconfig: (serverId: string, serverIp: string): Promise<unknown> => ipcRenderer.invoke('k8s:kubeconfig:cicd', serverId, serverIp),
    applyYaml: (serverId: string, yaml: string, ns?: string): Promise<unknown> => ipcRenderer.invoke('k8s:apply:yaml', serverId, yaml, ns),
    deleteResource: (serverId: string, type: string, name: string, ns: string): Promise<unknown> => ipcRenderer.invoke('k8s:delete:resource', serverId, type, name, ns)
  },
  rollout: {
    restart: (serverId: string, deployment: string, ns: string): Promise<unknown> => ipcRenderer.invoke('rollout:restart', serverId, deployment, ns),
    status: (serverId: string, deployment: string, ns: string): Promise<unknown> => ipcRenderer.invoke('rollout:status', serverId, deployment, ns),
    undo: (serverId: string, deployment: string, ns: string, revision?: number): Promise<unknown> => ipcRenderer.invoke('rollout:undo', serverId, deployment, ns, revision),
    history: (serverId: string, deployment: string, ns: string): Promise<unknown> => ipcRenderer.invoke('rollout:history', serverId, deployment, ns),
    scale: (serverId: string, deployment: string, ns: string, replicas: number): Promise<unknown> => ipcRenderer.invoke('rollout:scale', serverId, deployment, ns, replicas),
    setImage: (serverId: string, deployment: string, ns: string, container: string, image: string, tag: string): Promise<unknown> =>
      ipcRenderer.invoke('rollout:setImage', serverId, deployment, ns, container, image, tag)
  },
  git: {
    pull: (serverId: string, path: string, branch?: string): Promise<unknown> => ipcRenderer.invoke('git:pull', serverId, path, branch),
    status: (serverId: string, path: string): Promise<unknown> => ipcRenderer.invoke('git:status', serverId, path),
    lastCommit: (serverId: string, path: string): Promise<unknown> => ipcRenderer.invoke('git:lastCommit', serverId, path),
    branches: (serverId: string, path: string): Promise<string[]> => ipcRenderer.invoke('git:branches', serverId, path),
    log: (serverId: string, path: string, count?: number): Promise<unknown[]> => ipcRenderer.invoke('git:log', serverId, path, count)
  },
  github: {
    test: (config: unknown): Promise<unknown> => ipcRenderer.invoke('github:test', config),
    repos: (): Promise<unknown> => ipcRenderer.invoke('github:repos'),
    workflows: (owner: string, repo: string): Promise<unknown> => ipcRenderer.invoke('github:workflows', owner, repo),
    trigger: (owner: string, repo: string, workflowId: string | number, ref: string, inputs?: Record<string, string>): Promise<unknown> =>
      ipcRenderer.invoke('github:trigger', owner, repo, workflowId, ref, inputs),
    runs: (owner: string, repo: string): Promise<unknown> => ipcRenderer.invoke('github:runs', owner, repo),
    runJobs: (owner: string, repo: string, runId: number): Promise<unknown> => ipcRenderer.invoke('github:run:jobs', owner, repo, runId),
    setSecret: (owner: string, repo: string, secretName: string, secretValue: string): Promise<unknown> =>
      ipcRenderer.invoke('github:secret:set', owner, repo, secretName, secretValue),
    branches: (owner: string, repo: string): Promise<unknown> => ipcRenderer.invoke('github:branches', owner, repo)
  },
  gitlab: {
    test: (config: unknown): Promise<unknown> => ipcRenderer.invoke('gitlab:test', config),
    projects: (): Promise<unknown> => ipcRenderer.invoke('gitlab:projects'),
    pipelines: (projectId: string | number): Promise<unknown> => ipcRenderer.invoke('gitlab:pipelines', projectId),
    trigger: (projectId: string | number, ref: string, variables?: Record<string, string>): Promise<unknown> =>
      ipcRenderer.invoke('gitlab:trigger', projectId, ref, variables),
    pipelineJobs: (projectId: string | number, pipelineId: number): Promise<unknown> => ipcRenderer.invoke('gitlab:pipeline:jobs', projectId, pipelineId),
    setVariable: (projectId: string | number, key: string, value: string): Promise<unknown> =>
      ipcRenderer.invoke('gitlab:variable:set', projectId, key, value),
    branches: (projectId: string | number): Promise<unknown> => ipcRenderer.invoke('gitlab:branches', projectId)
  },
  terminal: {
    open: (serverId: string, cols: number, rows: number): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
      ipcRenderer.invoke('terminal:open', serverId, cols, rows),
    write: (sessionId: string, data: string): void => ipcRenderer.send('terminal:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', sessionId, cols, rows)
    },
    close: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('terminal:close', sessionId),
    onData: (sessionId: string, cb: (data: string) => void): (() => void) => {
      const channel = `terminal:data:${sessionId}`
      const handler = (_: unknown, data: string): void => cb(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onClose: (sessionId: string, cb: () => void): (() => void) => {
      const channel = `terminal:close:${sessionId}`
      const handler = (): void => cb()
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onError: (sessionId: string, cb: (error: string) => void): (() => void) => {
      const channel = `terminal:error:${sessionId}`
      const handler = (_: unknown, error: string): void => cb(error)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  }
}

contextBridge.exposeInMainWorld('monitcAPI', monitcAPI)
