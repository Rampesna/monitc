import { ipcMain } from 'electron'
import { sshManager } from '../ssh/ssh-manager'
import { K8S_MGMT } from '../ssh/k8s-management-commands'
import { ROLLOUT_CMDS } from '../ssh/rollout-commands'
import { GIT_CMDS } from '../ssh/git-commands'
import * as gh from '../ci/github-client'
import * as gl from '../ci/gitlab-client'
import { loadData, saveData } from '../store/store'
import type { ProjectLink, GitHubConfig, GitLabConfig } from '../store/types'
import crypto from 'crypto'

export function setupDevOpsHandlers(): void {
  function getData() { return loadData() }
  function save(data: ReturnType<typeof getData>) { saveData(data) }

  async function exec(serverId: string, cmd: string) {
    return sshManager.execCommand(serverId, cmd)
  }

  // ── Project Links ─────────────────────────────────────────────────────────
  ipcMain.handle('projects:list', () => getData().projectLinks ?? [])

  ipcMain.handle('projects:add', async (_, link: Omit<ProjectLink, 'id'>) => {
    const data = getData()
    const newLink: ProjectLink = { ...link, id: crypto.randomUUID() }
    data.projectLinks = [...(data.projectLinks ?? []), newLink]
    save(data)
    return newLink
  })

  ipcMain.handle('projects:update', async (_, link: ProjectLink) => {
    const data = getData()
    const idx = (data.projectLinks ?? []).findIndex((l) => l.id === link.id)
    if (idx !== -1) {
      data.projectLinks![idx] = link
      save(data)
    }
    return link
  })

  ipcMain.handle('projects:remove', async (_, id: string) => {
    const data = getData()
    data.projectLinks = (data.projectLinks ?? []).filter((l) => l.id !== id)
    save(data)
    return true
  })

  // ── K8s Management ────────────────────────────────────────────────────────
  ipcMain.handle('k8s:namespaces:list', async (_, serverId: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.listNamespaces)
      const parsed = JSON.parse(res.stdout)
      return (parsed.items ?? []).map((i: unknown) => {
        const item = i as { metadata: { name: string; creationTimestamp: string }; status: { phase: string } }
        return { name: item.metadata.name, status: item.status?.phase ?? 'Unknown', age: item.metadata.creationTimestamp }
      })
    } catch { return [] }
  })

  ipcMain.handle('k8s:namespaces:create', async (_, serverId: string, name: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.createNamespace(name))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:namespaces:delete', async (_, serverId: string, name: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.deleteNamespace(name))
      return { success: res.code === 0, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:secrets:list', async (_, serverId: string, ns: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.listSecrets(ns))
      const parsed = JSON.parse(res.stdout)
      return (parsed.items ?? []).map((i: unknown) => {
        const item = i as { metadata: { name: string; creationTimestamp: string; namespace: string }; type: string }
        return { name: item.metadata.name, type: item.type, namespace: item.metadata.namespace, age: item.metadata.creationTimestamp }
      })
    } catch { return [] }
  })

  ipcMain.handle('k8s:secrets:create:generic', async (_, serverId: string, name: string, ns: string, literals: Record<string, string>) => {
    try {
      const res = await exec(serverId, K8S_MGMT.createSecretGeneric(name, ns, literals))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:secrets:create:dockerregistry', async (_, serverId: string, name: string, ns: string, server: string, user: string, pass: string, email: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.createSecretDockerRegistry(name, ns, server, user, pass, email))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:secrets:delete', async (_, serverId: string, name: string, ns: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.deleteSecret(name, ns))
      return { success: res.code === 0, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:serviceaccounts:list', async (_, serverId: string, ns: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.listServiceAccounts(ns))
      const parsed = JSON.parse(res.stdout)
      return (parsed.items ?? []).map((i: unknown) => {
        const item = i as { metadata: { name: string; creationTimestamp: string; namespace: string } }
        return { name: item.metadata.name, namespace: item.metadata.namespace, age: item.metadata.creationTimestamp }
      })
    } catch { return [] }
  })

  ipcMain.handle('k8s:serviceaccounts:create', async (_, serverId: string, name: string, ns: string) => {
    try {
      const res1 = await exec(serverId, K8S_MGMT.createServiceAccount(name, ns))
      if (res1.code !== 0) return { success: false, error: res1.stderr }
      const res2 = await exec(serverId, K8S_MGMT.createClusterRoleBinding(`${name}-binding`, name, ns))
      const res3 = await exec(serverId, K8S_MGMT.createSATokenSecret(name, ns))
      return { success: res2.code === 0 || res3.code === 0, stdout: res1.stdout, error: res2.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:kubeconfig:get', async (_, serverId: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.getKubeconfig())
      return { success: res.code === 0 || res.stdout.length > 0, content: res.stdout.trim() }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:kubeconfig:cicd', async (_, serverId: string, serverIp: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.generateCICDKubeconfig(serverIp))
      return { success: res.code === 0 || res.stdout.length > 0, base64: res.stdout.trim() }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:apply:yaml', async (_, serverId: string, yaml: string, ns?: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.applyYaml(yaml, ns))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('k8s:delete:resource', async (_, serverId: string, type: string, name: string, ns: string) => {
    try {
      const res = await exec(serverId, K8S_MGMT.deleteResource(type, name, ns))
      return { success: res.code === 0, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  // ── Rollout ───────────────────────────────────────────────────────────────
  ipcMain.handle('rollout:restart', async (_, serverId: string, deployment: string, ns: string) => {
    try {
      const res = await exec(serverId, ROLLOUT_CMDS.restart(deployment, ns))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('rollout:status', async (_, serverId: string, deployment: string, ns: string) => {
    try {
      const res = await exec(serverId, ROLLOUT_CMDS.status(deployment, ns))
      return { success: true, stdout: res.stdout }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('rollout:undo', async (_, serverId: string, deployment: string, ns: string, revision?: number) => {
    try {
      const res = await exec(serverId, ROLLOUT_CMDS.undo(deployment, ns, revision))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('rollout:history', async (_, serverId: string, deployment: string, ns: string) => {
    try {
      const res = await exec(serverId, ROLLOUT_CMDS.history(deployment, ns))
      return { success: true, stdout: res.stdout }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('rollout:scale', async (_, serverId: string, deployment: string, ns: string, replicas: number) => {
    try {
      const res = await exec(serverId, ROLLOUT_CMDS.scale(deployment, ns, replicas))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('rollout:setImage', async (_, serverId: string, deployment: string, ns: string, container: string, image: string, tag: string) => {
    try {
      const res = await exec(serverId, ROLLOUT_CMDS.setImage(deployment, ns, container, image, tag))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  // ── Git ───────────────────────────────────────────────────────────────────
  ipcMain.handle('git:pull', async (_, serverId: string, path: string, branch?: string) => {
    try {
      const res = await exec(serverId, GIT_CMDS.pull(path, branch))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('git:status', async (_, serverId: string, path: string) => {
    try {
      const res = await exec(serverId, GIT_CMDS.status(path))
      return { success: true, stdout: res.stdout }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('git:lastCommit', async (_, serverId: string, path: string) => {
    try {
      const res = await exec(serverId, GIT_CMDS.lastCommit(path))
      if (!res.stdout.trim()) return null
      const [hash, shortHash, author, , date, ...msgParts] = res.stdout.trim().split('|')
      return { hash, shortHash, author, date, message: msgParts.join('|') }
    } catch { return null }
  })

  ipcMain.handle('git:branches', async (_, serverId: string, path: string) => {
    try {
      const res = await exec(serverId, GIT_CMDS.remoteBranches(path))
      return res.stdout.trim().split('\n').filter(Boolean)
    } catch { return [] }
  })

  ipcMain.handle('git:log', async (_, serverId: string, path: string, count?: number) => {
    try {
      const res = await exec(serverId, GIT_CMDS.log(path, count))
      return res.stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [hash, shortHash, author, date, ...msgParts] = line.split('|')
        return { hash, shortHash, author, date, message: msgParts.join('|') }
      })
    } catch { return [] }
  })

  // ── GitHub API ────────────────────────────────────────────────────────────
  function ghCreds(): { pat: string; baseUrl: string } | null {
    const cfg = getData().integrations.github
    if (!cfg?.enabled || !cfg.pat) return null
    return { pat: cfg.pat, baseUrl: cfg.baseUrl || 'https://api.github.com' }
  }

  ipcMain.handle('github:test', async (_, config: GitHubConfig) => {
    return gh.ghTestConnection(config.pat, config.baseUrl || 'https://api.github.com')
  })

  ipcMain.handle('github:repos', async () => {
    const creds = ghCreds()
    if (!creds) return { success: false, error: 'GitHub not configured' }
    try { return { success: true, data: await gh.ghListRepos(creds.pat, creds.baseUrl) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('github:workflows', async (_, owner: string, repo: string) => {
    const creds = ghCreds()
    if (!creds) return { success: false, error: 'GitHub not configured' }
    try { return { success: true, data: await gh.ghListWorkflows(creds.pat, creds.baseUrl, owner, repo) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('github:trigger', async (_, owner: string, repo: string, workflowId: string | number, ref: string, inputs?: Record<string, string>) => {
    const creds = ghCreds()
    if (!creds) return { success: false, error: 'GitHub not configured' }
    try { await gh.ghTriggerWorkflow(creds.pat, creds.baseUrl, owner, repo, workflowId, ref, inputs); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('github:runs', async (_, owner: string, repo: string) => {
    const creds = ghCreds()
    if (!creds) return { success: false, error: 'GitHub not configured' }
    try { return { success: true, data: await gh.ghListRuns(creds.pat, creds.baseUrl, owner, repo) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('github:run:jobs', async (_, owner: string, repo: string, runId: number) => {
    const creds = ghCreds()
    if (!creds) return { success: false, error: 'GitHub not configured' }
    try { return { success: true, data: await gh.ghGetRunJobs(creds.pat, creds.baseUrl, owner, repo, runId) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('github:secret:set', async (_, owner: string, repo: string, secretName: string, secretValue: string) => {
    const creds = ghCreds()
    if (!creds) return { success: false, error: 'GitHub not configured' }
    try { await gh.ghSetSecret(creds.pat, creds.baseUrl, owner, repo, secretName, secretValue); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('github:branches', async (_, owner: string, repo: string) => {
    const creds = ghCreds()
    if (!creds) return { success: false, error: 'GitHub not configured' }
    try { return { success: true, data: await gh.ghListBranches(creds.pat, creds.baseUrl, owner, repo) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  // ── GitLab API ────────────────────────────────────────────────────────────
  function glCreds(): { pat: string; baseUrl: string } | null {
    const cfg = getData().integrations.gitlab
    if (!cfg?.enabled || !cfg.pat) return null
    return { pat: cfg.pat, baseUrl: cfg.baseUrl || 'https://gitlab.com' }
  }

  ipcMain.handle('gitlab:test', async (_, config: GitLabConfig) => {
    return gl.glTestConnection(config.pat, config.baseUrl || 'https://gitlab.com')
  })

  ipcMain.handle('gitlab:projects', async () => {
    const creds = glCreds()
    if (!creds) return { success: false, error: 'GitLab not configured' }
    try { return { success: true, data: await gl.glListProjects(creds.pat, creds.baseUrl) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('gitlab:pipelines', async (_, projectId: string | number) => {
    const creds = glCreds()
    if (!creds) return { success: false, error: 'GitLab not configured' }
    try { return { success: true, data: await gl.glListPipelines(creds.pat, creds.baseUrl, projectId) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('gitlab:trigger', async (_, projectId: string | number, ref: string, variables?: Record<string, string>) => {
    const creds = glCreds()
    if (!creds) return { success: false, error: 'GitLab not configured' }
    try { return { success: true, data: await gl.glTriggerPipeline(creds.pat, creds.baseUrl, projectId, ref, variables) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('gitlab:pipeline:jobs', async (_, projectId: string | number, pipelineId: number) => {
    const creds = glCreds()
    if (!creds) return { success: false, error: 'GitLab not configured' }
    try { return { success: true, data: await gl.glGetPipelineJobs(creds.pat, creds.baseUrl, projectId, pipelineId) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('gitlab:variable:set', async (_, projectId: string | number, key: string, value: string) => {
    const creds = glCreds()
    if (!creds) return { success: false, error: 'GitLab not configured' }
    try { return { success: true, data: await gl.glSetVariable(creds.pat, creds.baseUrl, projectId, key, value) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('gitlab:branches', async (_, projectId: string | number) => {
    const creds = glCreds()
    if (!creds) return { success: false, error: 'GitLab not configured' }
    try { return { success: true, data: await gl.glListBranches(creds.pat, creds.baseUrl, projectId) } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })
}
