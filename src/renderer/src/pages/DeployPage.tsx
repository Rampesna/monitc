import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import type { ProjectLink } from '../lib/types'

type WizardStep = 'provider' | 'repo' | 'server' | 'details' | 'done'

interface GHRepo { id: number; full_name: string; name: string; default_branch: string; owner: { login: string } }
interface GHWorkflow { id: number; name: string }
interface GLProject { id: number; name_with_namespace: string; name: string; default_branch: string }

function Spinner() {
  return <svg className="w-4 h-4 animate-spin text-indigo-400 inline-block" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
}

function OpResult({ result, onClear }: { result: { success: boolean; message: string }; onClear: () => void }) {
  return (
    <div className={`flex items-start justify-between gap-3 p-3 rounded-lg text-sm ${result.success ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
      <pre className="whitespace-pre-wrap font-mono text-xs flex-1 max-h-32 overflow-y-auto">{result.message}</pre>
      <button onClick={onClear} className="text-current opacity-50 hover:opacity-100 flex-shrink-0">✕</button>
    </div>
  )
}

export default function DeployPage() {
  const { t } = useTranslation()
  const { state } = useApp()
  const [projects, setProjects] = useState<ProjectLink[]>([])
  const [selectedProject, setSelectedProject] = useState<ProjectLink | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('provider')
  const [opResult, setOpResult] = useState<{ success: boolean; message: string } | null>(null)
  const [opLoading, setOpLoading] = useState(false)
  const [commitInfo, setCommitInfo] = useState<{ hash: string; message: string; author: string; date: string } | null>(null)
  const [gitStatus, setGitStatus] = useState<string>('')
  const [rolloutStatus, setRolloutStatus] = useState<string>('')
  const [scaleReplicas, setScaleReplicas] = useState(1)
  const [newImage, setNewImage] = useState('')
  const [newTag, setNewTag] = useState('latest')

  // Wizard state
  const [wizardProvider, setWizardProvider] = useState<'github' | 'gitlab'>('github')
  const [ghRepos, setGhRepos] = useState<GHRepo[]>([])
  const [glProjects, setGlProjects] = useState<GLProject[]>([])
  const [ghWorkflows, setGhWorkflows] = useState<GHWorkflow[]>([])
  const [wizardRepo, setWizardRepo] = useState<GHRepo | GLProject | null>(null)
  const [wizardName, setWizardName] = useState('')
  const [wizardBranch, setWizardBranch] = useState('main')
  const [wizardPath, setWizardPath] = useState('/app')
  const [wizardNs, setWizardNs] = useState('default')
  const [wizardDeployment, setWizardDeployment] = useState('')
  const [wizardContainer, setWizardContainer] = useState('')
  const [wizardWorkflowId, setWizardWorkflowId] = useState<number | null>(null)
  const [wizardLoading, setWizardLoading] = useState(false)

  const loadProjects = useCallback(async () => {
    const data = await window.monitcAPI.projects.list()
    setProjects(data as ProjectLink[])
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  const selectProject = useCallback(async (p: ProjectLink) => {
    setSelectedProject(p)
    setOpResult(null)
    setCommitInfo(null)
    setGitStatus('')
    setRolloutStatus('')
    if (p.serverId && p.serverPath) {
      const [commit, status] = await Promise.all([
        window.monitcAPI.git.lastCommit(p.serverId, p.serverPath),
        window.monitcAPI.git.status(p.serverId, p.serverPath)
      ])
      if (commit) setCommitInfo(commit as { hash: string; message: string; author: string; date: string })
      const s = status as { stdout: string }
      setGitStatus(s.stdout?.trim() ?? '')
    }
    if (p.serverId && p.deploymentName && p.namespace) {
      const rs = await window.monitcAPI.rollout.status(p.serverId, p.deploymentName, p.namespace)
      setRolloutStatus((rs as { stdout: string }).stdout ?? '')
    }
  }, [])

  const doOp = async (fn: () => Promise<{ success: boolean; stdout?: string; error?: string }>, label: string) => {
    setOpLoading(true)
    setOpResult(null)
    const res = await fn()
    setOpResult({ success: res.success, message: res.success ? (res.stdout ?? label) : (res.error ?? t('common.error')) })
    setOpLoading(false)
    return res.success
  }

  const doPull = () => {
    if (!selectedProject) return
    doOp(() => window.monitcAPI.git.pull(selectedProject.serverId, selectedProject.serverPath, selectedProject.branch) as Promise<{ success: boolean; stdout?: string; error?: string }>, 'Git pull')
  }

  const doRolloutRestart = () => {
    if (!selectedProject?.deploymentName) return
    doOp(() => window.monitcAPI.rollout.restart(selectedProject.serverId, selectedProject.deploymentName!, selectedProject.namespace) as Promise<{ success: boolean; stdout?: string; error?: string }>, 'Rollout restart')
  }

  const doRolloutUndo = () => {
    if (!selectedProject?.deploymentName) return
    doOp(() => window.monitcAPI.rollout.undo(selectedProject.serverId, selectedProject.deploymentName!, selectedProject.namespace) as Promise<{ success: boolean; stdout?: string; error?: string }>, 'Rollout undo')
  }

  const doScale = () => {
    if (!selectedProject?.deploymentName) return
    doOp(() => window.monitcAPI.rollout.scale(selectedProject.serverId, selectedProject.deploymentName!, selectedProject.namespace, scaleReplicas) as Promise<{ success: boolean; stdout?: string; error?: string }>, `Scale to ${scaleReplicas}`)
  }

  const doSetImage = () => {
    if (!selectedProject?.deploymentName || !newImage) return
    const container = selectedProject.containerName ?? selectedProject.deploymentName!
    doOp(() => window.monitcAPI.rollout.setImage(selectedProject.serverId, selectedProject.deploymentName!, selectedProject.namespace, container, newImage, newTag) as Promise<{ success: boolean; stdout?: string; error?: string }>, 'Image update')
  }

  const doCICD = async () => {
    if (!selectedProject) return
    setOpLoading(true)
    setOpResult(null)
    let res: { success: boolean; error?: string }
    if (selectedProject.provider === 'github' && selectedProject.workflowId) {
      res = await window.monitcAPI.github.trigger(selectedProject.repoOwner, selectedProject.repoName, selectedProject.workflowId, selectedProject.branch) as { success: boolean; error?: string }
    } else if (selectedProject.provider === 'gitlab' && selectedProject.repoId) {
      res = await window.monitcAPI.gitlab.trigger(selectedProject.repoId, selectedProject.branch) as { success: boolean; error?: string }
    } else {
      res = { success: false, error: t('deploy.notConfiguredCI') }
    }
    setOpResult({ success: res.success, message: res.success ? t('deploy.runPipeline') : (res.error ?? t('common.error')) })
    setOpLoading(false)
  }

  const deleteProject = async (id: string) => {
    if (!confirm(t('deploy.deleteProjectConfirm'))) return
    await window.monitcAPI.projects.remove(id)
    if (selectedProject?.id === id) setSelectedProject(null)
    loadProjects()
  }

  const startWizard = () => { setShowWizard(true); setWizardStep('provider') }

  const wizardNext = async () => {
    if (wizardStep === 'provider') {
      setWizardLoading(true)
      if (wizardProvider === 'github') {
        const res = await window.monitcAPI.github.repos() as { data?: GHRepo[] }
        setGhRepos(res.data ?? [])
      } else {
        const res = await window.monitcAPI.gitlab.projects() as { data?: GLProject[] }
        setGlProjects(res.data ?? [])
      }
      setWizardLoading(false)
      setWizardStep('repo')
    } else if (wizardStep === 'repo') {
      if (wizardProvider === 'github' && wizardRepo) {
        const r = wizardRepo as GHRepo
        setWizardLoading(true)
        const res = await window.monitcAPI.github.workflows(r.owner.login, r.name) as { success: boolean; data?: { workflows?: GHWorkflow[] } }
        setGhWorkflows(res.data?.workflows ?? [])
        setWizardBranch(r.default_branch)
        setWizardLoading(false)
      }
      setWizardStep('server')
    } else if (wizardStep === 'server') {
      setWizardStep('details')
    } else if (wizardStep === 'details') {
      if (!wizardName.trim() || !wizardRepo) return
      const r = wizardRepo as GHRepo & GLProject
      const link: Omit<ProjectLink, 'id'> = {
        serverId: state.selectedServerId ?? '',
        name: wizardName,
        provider: wizardProvider,
        repoOwner: wizardProvider === 'github' ? r.owner?.login ?? '' : '',
        repoName: wizardProvider === 'github' ? r.name : r.name,
        repoId: wizardProvider === 'gitlab' ? r.id : undefined,
        branch: wizardBranch,
        serverPath: wizardPath,
        namespace: wizardNs,
        deploymentName: wizardDeployment || undefined,
        containerName: wizardContainer || undefined,
        workflowId: wizardWorkflowId ? String(wizardWorkflowId) : undefined
      }
      await window.monitcAPI.projects.add(link)
      await loadProjects()
      setShowWizard(false)
      setWizardStep('provider')
    }
  }

  const serverForProject = (p: ProjectLink) => state.servers.find((s) => s.id === p.serverId)

  return (
    <div className="flex h-full">
      {/* Project list */}
      <div className="w-64 border-r border-[#1e1e2e] flex flex-col">
        <div className="p-4 border-b border-[#1e1e2e] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">{t('deploy.title')}</h2>
          <button onClick={startWizard} className="text-xs px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-medium">+ {t('common.add')}</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {projects.length === 0 ? (
            <div className="py-10 px-4 text-center text-sm text-slate-500">
              <p className="mb-3">{t('deploy.noProjects')}</p>
              <button onClick={startWizard} className="text-indigo-400 hover:text-indigo-300 underline">{t('deploy.addProject')}</button>
            </div>
          ) : projects.map((p) => {
            const srv = serverForProject(p)
            return (
              <div key={p.id} className={`group flex items-start justify-between px-3 py-3 border-b border-[#1e1e2e] cursor-pointer transition-colors ${selectedProject?.id === p.id ? 'bg-indigo-600/10' : 'hover:bg-white/2'}`} onClick={() => selectProject(p)}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 truncate">{p.repoOwner}/{p.repoName}</p>
                  <p className="text-xs text-slate-600 truncate">{srv?.name ?? p.serverId.slice(0, 8)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">{p.provider === 'github' ? '🐙' : '🦊'}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteProject(p.id) }} className="text-red-400 opacity-0 group-hover:opacity-100 text-xs hover:text-red-300">✕</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {!selectedProject ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            {t('cicd.selectProject')}
          </div>
        ) : (
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-100">{selectedProject.name}</h1>
                <p className="text-sm text-slate-400 mt-0.5">{selectedProject.repoOwner}/{selectedProject.repoName} · {selectedProject.branch}</p>
              </div>
              <span className="text-sm px-2.5 py-1 rounded-lg bg-slate-800/60 text-slate-300">{serverForProject(selectedProject)?.name ?? selectedProject.serverId.slice(0, 8)}</span>
            </div>

            {opResult && <OpResult result={opResult} onClear={() => setOpResult(null)} />}

            {/* Git status */}
            <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">{t('deploy.gitStatus')}</h3>
                <button onClick={doPull} disabled={opLoading} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-xs font-medium text-slate-200 transition-colors">
                  {opLoading ? <Spinner /> : '↓'} {t('deploy.gitPull')}
                </button>
              </div>
              {commitInfo && (
                <div className="space-y-1">
                  <div className="flex gap-3 text-xs">
                    <span className="font-mono text-indigo-400">{commitInfo.hash?.slice(0, 8)}</span>
                    <span className="text-slate-300 flex-1 truncate">{commitInfo.message}</span>
                  </div>
                  <div className="text-xs text-slate-500">{commitInfo.author} · {new Date(commitInfo.date).toLocaleString()}</div>
                </div>
              )}
              {gitStatus && (
                <pre className="text-xs font-mono text-slate-400 bg-slate-900/60 rounded-lg p-2 max-h-24 overflow-y-auto">{gitStatus}</pre>
              )}
              {!commitInfo && !gitStatus && <p className="text-xs text-slate-500">{selectedProject.serverPath}</p>}
            </div>

            {/* CI/CD trigger */}
            <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">{t('deploy.cicdPipeline')}</h3>
                <button onClick={doCICD} disabled={opLoading || (!selectedProject.workflowId && !selectedProject.repoId)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded-lg text-xs font-medium text-white transition-colors">
                  {opLoading ? <Spinner /> : '▶'} {t('deploy.runPipeline')}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                {selectedProject.provider === 'github'
                  ? t('deploy.ghActionsWorkflow', { id: selectedProject.workflowId ?? t('deploy.notSetup') })
                  : t('deploy.gitlabProject', { id: selectedProject.repoId ?? t('deploy.notSetup') })}
              </p>
            </div>

            {/* K8s Rollout */}
            {selectedProject.deploymentName && (
              <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 space-y-4">
                <h3 className="text-sm font-semibold text-slate-200">{t('deploy.k8sRollout')}</h3>
                <p className="text-xs text-slate-400">
                  Deployment: <code className="text-indigo-300">{selectedProject.deploymentName}</code> · {t('common.namespace')}: <code className="text-indigo-300">{selectedProject.namespace}</code>
                </p>

                {rolloutStatus && (
                  <pre className="text-xs font-mono text-slate-400 bg-slate-900/60 rounded-lg p-2 max-h-20 overflow-y-auto">{rolloutStatus}</pre>
                )}

                {/* Quick actions */}
                <div className="flex flex-wrap gap-2">
                  <button onClick={doRolloutRestart} disabled={opLoading} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700/60 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-xs font-medium text-blue-200 transition-colors">
                    {opLoading ? <Spinner /> : '↺'} {t('deploy.restart')}
                  </button>
                  <button onClick={doRolloutUndo} disabled={opLoading} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700/60 hover:bg-amber-700 disabled:opacity-50 rounded-lg text-xs font-medium text-amber-200 transition-colors">
                    {opLoading ? <Spinner /> : '↩'} {t('deploy.undo')}
                  </button>
                </div>

                {/* Scale */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 w-24">{t('deploy.replicaCount')}</label>
                  <input type="number" min={0} max={50} value={scaleReplicas} onChange={(e) => setScaleReplicas(Number(e.target.value))} className="w-20 bg-slate-900/60 border border-slate-600/50 rounded-lg px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/70" />
                  <button onClick={doScale} disabled={opLoading} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-xs text-slate-200 transition-colors">{t('common.apply')}</button>
                </div>

                {/* Set image */}
                <div className="space-y-2">
                  <label className="text-xs text-slate-400">{t('deploy.updateImage')}</label>
                  <div className="flex gap-2">
                    <input value={newImage} onChange={(e) => setNewImage(e.target.value)} placeholder={t('deploy.imageName')} className="flex-1 bg-slate-900/60 border border-slate-600/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                    <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={t('deploy.imageTag')} className="w-24 bg-slate-900/60 border border-slate-600/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                    <button onClick={doSetImage} disabled={opLoading || !newImage} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors">
                      {opLoading ? <Spinner /> : t('deploy.update')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Wizard modal */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f0f19] border border-[#1e1e2e] rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="p-5 border-b border-[#1e1e2e] flex items-center justify-between">
              <h2 className="font-semibold text-slate-100">{t('deploy.wizardTitle')}</h2>
              <button onClick={() => setShowWizard(false)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <div className="p-5 space-y-4">
              {wizardStep === 'provider' && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400">{t('deploy.wizardSelectProvider')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {(['github', 'gitlab'] as const).map((p) => (
                      <button key={p} onClick={() => setWizardProvider(p)} className={`p-4 rounded-xl border-2 text-center transition-colors ${wizardProvider === p ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700/50 hover:border-slate-600'}`}>
                        <span className="text-3xl">{p === 'github' ? '🐙' : '🦊'}</span>
                        <p className="mt-2 font-medium text-slate-200 capitalize">{p}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {wizardStep === 'repo' && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400">{t('deploy.wizardSelectRepo')}</p>
                  {wizardLoading ? <div className="py-4 flex justify-center"><Spinner /></div> : (
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {(wizardProvider === 'github' ? ghRepos : glProjects).map((r) => {
                        const isGH = wizardProvider === 'github'
                        const label = isGH ? (r as GHRepo).full_name : (r as GLProject).name_with_namespace
                        return (
                          <button key={(r as GHRepo).id ?? (r as GLProject).id} onClick={() => setWizardRepo(r)} className={`w-full px-3 py-2 rounded-lg text-left text-sm transition-colors ${wizardRepo === r ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-300 hover:bg-white/5'}`}>
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {wizardStep === 'server' && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400">{t('deploy.wizardServerBranch')}</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">{t('deploy.wizardServer')}</label>
                      <select className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none" defaultValue={state.selectedServerId ?? ''}>
                        {state.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">{t('deploy.wizardBranch')}</label>
                      <input value={wizardBranch} onChange={(e) => setWizardBranch(e.target.value)} className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/70" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">{t('deploy.wizardPath')}</label>
                      <input value={wizardPath} onChange={(e) => setWizardPath(e.target.value)} placeholder={t('deploy.wizardPathPlaceholder')} className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 'details' && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400">{t('deploy.wizardDetails')}</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">{t('deploy.wizardProjectName')}</label>
                      <input value={wizardName} onChange={(e) => setWizardName(e.target.value)} placeholder={t('deploy.wizardProjectNamePlaceholder')} className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">{t('deploy.wizardNamespace')}</label>
                        <input value={wizardNs} onChange={(e) => setWizardNs(e.target.value)} className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/70" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">{t('deploy.wizardDeployment')}</label>
                        <input value={wizardDeployment} onChange={(e) => setWizardDeployment(e.target.value)} placeholder={t('deploy.wizardDeploymentPlaceholder')} className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                      </div>
                    </div>
                    {wizardProvider === 'github' && ghWorkflows.length > 0 && (
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">{t('deploy.wizardWorkflow')}</label>
                        <select value={wizardWorkflowId ?? ''} onChange={(e) => setWizardWorkflowId(Number(e.target.value))} className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none">
                          <option value="">{t('deploy.wizardWorkflowPlaceholder')}</option>
                          {ghWorkflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-[#1e1e2e] flex justify-between">
              <button
                onClick={() => {
                  const steps: WizardStep[] = ['provider', 'repo', 'server', 'details', 'done']
                  const idx = steps.indexOf(wizardStep)
                  if (idx > 0) setWizardStep(steps[idx - 1])
                  else setShowWizard(false)
                }}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                {wizardStep === 'provider' ? t('common.cancel') : `← ${t('common.back')}`}
              </button>
              <button onClick={wizardNext} disabled={wizardLoading || (wizardStep === 'repo' && !wizardRepo) || (wizardStep === 'details' && !wizardName.trim())} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-semibold text-white transition-colors">
                {wizardLoading ? t('common.loading') : wizardStep === 'details' ? t('deploy.saveProject') : `${t('common.next')} →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
