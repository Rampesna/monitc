import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type Provider = 'github' | 'gitlab'

interface GHRepo { id: number; full_name: string; default_branch: string; name: string; owner: { login: string } }
interface GHWorkflow { id: number; name: string; path: string; state: string }
interface GHRun { id: number; name: string; status: string; conclusion: string | null; head_branch: string; created_at: string; updated_at: string; html_url: string; run_number: number; head_commit: { message: string; id: string } }
interface GHJob { id: number; name: string; status: string; conclusion: string | null; steps?: { name: string; status: string; conclusion: string | null; number: number }[] }
interface GLProject { id: number; name_with_namespace: string; name: string; default_branch: string; web_url: string }
interface GLPipeline { id: number; status: string; ref: string; sha: string; created_at: string; updated_at: string; web_url: string }

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <svg className="w-5 h-5 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

function statusBadge(status: string, conclusion: string | null) {
  const s = conclusion ?? status
  const map: Record<string, string> = {
    success: 'bg-green-500/15 text-green-400',
    completed: 'bg-green-500/15 text-green-400',
    failure: 'bg-red-500/15 text-red-400',
    failed: 'bg-red-500/15 text-red-400',
    cancelled: 'bg-slate-500/15 text-slate-400',
    running: 'bg-blue-500/15 text-blue-400',
    in_progress: 'bg-blue-500/15 text-blue-400',
    pending: 'bg-yellow-500/15 text-yellow-400',
    queued: 'bg-yellow-500/15 text-yellow-400',
    waiting: 'bg-yellow-500/15 text-yellow-400',
    skipped: 'bg-slate-500/15 text-slate-400',
    manual: 'bg-purple-500/15 text-purple-400'
  }
  const cls = map[s.toLowerCase()] ?? 'bg-slate-500/15 text-slate-400'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{s}</span>
}

function timeSince(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60) return `${Math.round(d)}s`
  if (d < 3600) return `${Math.round(d / 60)}m`
  if (d < 86400) return `${Math.round(d / 3600)}h`
  return `${Math.round(d / 86400)}d`
}

export default function CICDPage() {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<Provider>('github')

  // GitHub state
  const [ghRepos, setGhRepos] = useState<GHRepo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<GHRepo | null>(null)
  const [workflows, setWorkflows] = useState<GHWorkflow[]>([])
  const [runs, setRuns] = useState<GHRun[]>([])
  const [selectedRun, setSelectedRun] = useState<GHRun | null>(null)
  const [runJobs, setRunJobs] = useState<GHJob[]>([])
  const [triggerWfId, setTriggerWfId] = useState<number | null>(null)
  const [triggerRef, setTriggerRef] = useState('main')
  const [triggering, setTriggering] = useState(false)
  const [triggerResult, setTriggerResult] = useState<{ success: boolean; message: string } | null>(null)

  // GitLab state
  const [glProjects, setGlProjects] = useState<GLProject[]>([])
  const [selectedProject, setSelectedProject] = useState<GLProject | null>(null)
  const [pipelines, setPipelines] = useState<GLPipeline[]>([])
  const [selectedPipeline, setSelectedPipeline] = useState<GLPipeline | null>(null)
  const [glJobs, setGlJobs] = useState<GHJob[]>([])
  const [glTriggerRef, setGlTriggerRef] = useState('main')
  const [glTriggering, setGlTriggering] = useState(false)
  const [glTriggerResult, setGlTriggerResult] = useState<{ success: boolean; message: string } | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGhRepos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.monitcAPI.github.repos() as { success: boolean; data?: GHRepo[]; error?: string }
      if (res.success) setGhRepos(res.data ?? [])
      else setError(res.error ?? t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const loadGlProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.monitcAPI.gitlab.projects() as { success: boolean; data?: GLProject[]; error?: string }
      if (res.success) setGlProjects(res.data ?? [])
      else setError(res.error ?? t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (provider === 'github') loadGhRepos()
    else loadGlProjects()
  }, [provider, loadGhRepos, loadGlProjects])

  const selectRepo = async (repo: GHRepo) => {
    setSelectedRepo(repo)
    setSelectedRun(null)
    setRunJobs([])
    setLoading(true)
    const [wfRes, runRes] = await Promise.all([
      window.monitcAPI.github.workflows(repo.owner.login, repo.name) as Promise<{ success: boolean; data?: { workflows?: GHWorkflow[]; total_count?: number } }>,
      window.monitcAPI.github.runs(repo.owner.login, repo.name) as Promise<{ success: boolean; data?: { workflow_runs?: GHRun[]; total_count?: number } }>
    ])
    setWorkflows(wfRes.data?.workflows ?? [])
    setRuns((runRes.data?.workflow_runs ?? []).slice(0, 20))
    setLoading(false)
  }

  const selectRun = async (run: GHRun) => {
    setSelectedRun(run)
    if (!selectedRepo) return
    const res = await window.monitcAPI.github.runJobs(selectedRepo.owner.login, selectedRepo.name, run.id) as { success: boolean; data?: { jobs?: GHJob[] } }
    setRunJobs(res.data?.jobs ?? [])
  }

  const triggerWorkflow = async () => {
    if (!selectedRepo || !triggerWfId) return
    setTriggering(true)
    setTriggerResult(null)
    const res = await window.monitcAPI.github.trigger(selectedRepo.owner.login, selectedRepo.name, triggerWfId, triggerRef) as { success: boolean; error?: string }
    setTriggerResult(res.success
      ? { success: true, message: t('cicd.workflowTriggered') }
      : { success: false, message: res.error ?? t('common.error') })
    setTriggering(false)
    if (res.success) setTimeout(() => { selectRepo(selectedRepo) }, 3000)
  }

  const selectProject = async (p: GLProject) => {
    setSelectedProject(p)
    setSelectedPipeline(null)
    setGlJobs([])
    setLoading(true)
    const res = await window.monitcAPI.gitlab.pipelines(p.id) as { success: boolean; data?: GLPipeline[] }
    setPipelines(((res.data ?? []) as GLPipeline[]).slice(0, 20))
    setLoading(false)
  }

  const selectPipeline = async (p: GLPipeline) => {
    setSelectedPipeline(p)
    if (!selectedProject) return
    const res = await window.monitcAPI.gitlab.pipelineJobs(selectedProject.id, p.id) as { success: boolean; data?: GHJob[] }
    setGlJobs((res.data as GHJob[]) ?? [])
  }

  const triggerGlPipeline = async () => {
    if (!selectedProject) return
    setGlTriggering(true)
    setGlTriggerResult(null)
    const res = await window.monitcAPI.gitlab.trigger(selectedProject.id, glTriggerRef) as { success: boolean; error?: string }
    setGlTriggerResult(res.success
      ? { success: true, message: t('cicd.pipelineTriggered') }
      : { success: false, message: res.error ?? t('common.error') })
    setGlTriggering(false)
    if (res.success) setTimeout(() => { selectProject(selectedProject) }, 3000)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-[#1e1e2e]">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-slate-100">{t('cicd.title')}</h1>
          <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg">
            <button
              onClick={() => { setProvider('github'); setSelectedRepo(null); setSelectedRun(null) }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${provider === 'github' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              🐙 GitHub
            </button>
            <button
              onClick={() => { setProvider('gitlab'); setSelectedProject(null); setSelectedPipeline(null) }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${provider === 'gitlab' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              🦊 GitLab
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
          {error.includes('not configured') ? (
            <>{t('cicd.notConfigured')} <span className="underline cursor-pointer">{t('cicd.goToSettings')}</span></>
          ) : error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Provider === github */}
        {provider === 'github' && (
          <>
            {/* Repo list */}
            <div className="w-60 border-r border-[#1e1e2e] overflow-y-auto">
              <div className="p-3 border-b border-[#1e1e2e] flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">{t('cicd.repositories')}</span>
                <button onClick={loadGhRepos} className="text-slate-400 hover:text-slate-200">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
              {loading && ghRepos.length === 0 ? <Spinner /> : (
                <div>
                  {ghRepos.map((r) => (
                    <button key={r.id} onClick={() => selectRepo(r)} className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${selectedRepo?.id === r.id ? 'bg-indigo-600/15 text-indigo-300' : 'text-slate-300 hover:bg-white/3'}`}>
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-slate-500 truncate">{r.owner.login}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Run list + detail */}
            {selectedRepo ? (
              <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto border-r border-[#1e1e2e]">
                  {/* Trigger */}
                  <div className="p-4 border-b border-[#1e1e2e] bg-slate-900/30">
                    <p className="text-xs font-medium text-slate-400 mb-2">{t('cicd.triggerWorkflow')}</p>
                    <div className="flex gap-2">
                      <select value={triggerWfId ?? ''} onChange={(e) => setTriggerWfId(Number(e.target.value))} className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none">
                        <option value="">{t('cicd.selectWorkflow')}</option>
                        {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <input value={triggerRef} onChange={(e) => setTriggerRef(e.target.value)} placeholder={t('cicd.branch')} className="w-28 bg-slate-800/80 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none" />
                      <button onClick={triggerWorkflow} disabled={triggering || !triggerWfId} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors">
                        {triggering ? '...' : t('cicd.runWorkflow')}
                      </button>
                    </div>
                    {triggerResult && (
                      <p className={`mt-2 text-xs ${triggerResult.success ? 'text-green-400' : 'text-red-400'}`}>{triggerResult.message}</p>
                    )}
                  </div>

                  {/* Runs */}
                  <div className="p-3 border-b border-[#1e1e2e] flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">{t('cicd.recentRuns')}</span>
                    <button onClick={() => selectRepo(selectedRepo)} className="text-slate-400 hover:text-slate-200">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                  </div>
                  {loading ? <Spinner /> : runs.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 text-sm">{t('cicd.noRuns')}</div>
                  ) : (
                    <div>
                      {runs.map((r) => (
                        <button key={r.id} onClick={() => selectRun(r)} className={`w-full px-4 py-3 text-left transition-colors border-b border-[#1e1e2e] ${selectedRun?.id === r.id ? 'bg-indigo-600/10' : 'hover:bg-white/2'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-slate-200 truncate max-w-[180px]">{r.name}</span>
                            {statusBadge(r.status, r.conclusion)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>#{r.run_number}</span>
                            <span>{r.head_branch}</span>
                            <span>{timeSince(r.created_at)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Job detail */}
                {selectedRun && (
                  <div className="w-72 overflow-y-auto p-4">
                    <div className="mb-3">
                      <p className="text-sm font-semibold text-slate-200">{selectedRun.name} #{selectedRun.run_number}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{selectedRun.head_commit?.message}</p>
                    </div>
                    <div className="space-y-2">
                      {runJobs.map((j) => (
                        <div key={j.id} className="bg-slate-800/50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-slate-300">{j.name}</span>
                            {statusBadge(j.status, j.conclusion)}
                          </div>
                          {j.steps && j.steps.length > 0 && (
                            <div className="space-y-1">
                              {j.steps.map((s) => (
                                <div key={s.number} className="flex items-center gap-2 text-xs text-slate-500">
                                  <span className={s.conclusion === 'success' ? 'text-green-400' : s.conclusion === 'failure' ? 'text-red-400' : 'text-slate-500'}>
                                    {s.conclusion === 'success' ? '✓' : s.conclusion === 'failure' ? '✗' : '·'}
                                  </span>
                                  <span className="truncate">{s.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                {t('cicd.selectRepo')}
              </div>
            )}
          </>
        )}

        {/* Provider === gitlab */}
        {provider === 'gitlab' && (
          <>
            <div className="w-60 border-r border-[#1e1e2e] overflow-y-auto">
              <div className="p-3 border-b border-[#1e1e2e] flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">{t('cicd.projects')}</span>
                <button onClick={loadGlProjects} className="text-slate-400 hover:text-slate-200">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
              {loading && glProjects.length === 0 ? <Spinner /> : (
                <div>
                  {glProjects.map((p) => (
                    <button key={p.id} onClick={() => selectProject(p)} className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${selectedProject?.id === p.id ? 'bg-indigo-600/15 text-indigo-300' : 'text-slate-300 hover:bg-white/3'}`}>
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-xs text-slate-500 truncate">{p.name_with_namespace}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedProject ? (
              <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto border-r border-[#1e1e2e]">
                  <div className="p-4 border-b border-[#1e1e2e] bg-slate-900/30">
                    <p className="text-xs font-medium text-slate-400 mb-2">{t('cicd.triggerPipeline')}</p>
                    <div className="flex gap-2">
                      <input value={glTriggerRef} onChange={(e) => setGlTriggerRef(e.target.value)} placeholder={t('cicd.branch')} className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none" />
                      <button onClick={triggerGlPipeline} disabled={glTriggering} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors">
                        {glTriggering ? '...' : t('cicd.runPipeline')}
                      </button>
                    </div>
                    {glTriggerResult && (
                      <p className={`mt-2 text-xs ${glTriggerResult.success ? 'text-green-400' : 'text-red-400'}`}>{glTriggerResult.message}</p>
                    )}
                  </div>

                  <div className="p-3 border-b border-[#1e1e2e]">
                    <span className="text-xs font-medium text-slate-400">{t('cicd.recentPipelines')}</span>
                  </div>
                  {loading ? <Spinner /> : pipelines.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 text-sm">{t('cicd.noPipelines')}</div>
                  ) : (
                    <div>
                      {pipelines.map((p) => (
                        <button key={p.id} onClick={() => selectPipeline(p)} className={`w-full px-4 py-3 text-left transition-colors border-b border-[#1e1e2e] ${selectedPipeline?.id === p.id ? 'bg-indigo-600/10' : 'hover:bg-white/2'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-slate-200">#{p.id}</span>
                            {statusBadge(p.status, null)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{p.ref}</span>
                            <span className="font-mono">{p.sha.slice(0, 8)}</span>
                            <span>{timeSince(p.created_at)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedPipeline && (
                  <div className="w-72 overflow-y-auto p-4">
                    <p className="text-sm font-semibold text-slate-200 mb-3">{t('cicd.jobsTitle')} #{selectedPipeline.id}</p>
                    <div className="space-y-2">
                      {glJobs.map((j) => (
                        <div key={j.id} className="bg-slate-800/50 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-300">{j.name}</span>
                            {statusBadge(j.status, j.conclusion)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                {t('cicd.selectProject')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
