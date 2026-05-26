import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import type { K8sNamespace, K8sSecret } from '../lib/types'

type Tab = 'namespaces' | 'secrets' | 'serviceaccounts' | 'kubeconfig'

interface SA { name: string; namespace: string; age: string }

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      <svg className="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <svg className="w-6 h-6 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

export default function K8sManagePage() {
  const { t } = useTranslation()
  const { state } = useApp()
  const server = state.selectedServerId ? state.servers.find((s) => s.id === state.selectedServerId) : null
  const [activeTab, setActiveTab] = useState<Tab>('namespaces')
  const [loading, setLoading] = useState(false)
  const [namespaces, setNamespaces] = useState<K8sNamespace[]>([])
  const [secrets, setSecrets] = useState<K8sSecret[]>([])
  const [serviceAccounts, setServiceAccounts] = useState<SA[]>([])
  const [selectedNs, setSelectedNs] = useState('default')
  const [nsInput, setNsInput] = useState('')
  const [kubeconfigContent, setKubeconfigContent] = useState('')
  const [kubeconfigB64, setKubeconfigB64] = useState('')
  const [copied, setCopied] = useState(false)
  const [opResult, setOpResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showNewSecret, setShowNewSecret] = useState(false)
  const [newSecretName, setNewSecretName] = useState('')
  const [newSecretKey, setNewSecretKey] = useState('')
  const [newSecretValue, setNewSecretValue] = useState('')
  const [showNewSA, setShowNewSA] = useState(false)
  const [newSAName, setNewSAName] = useState('')

  const sid = server?.id ?? ''

  const loadNamespaces = useCallback(async () => {
    if (!sid) return
    setLoading(true)
    try {
      const data = await window.monitcAPI.k8sManage.listNamespaces(sid)
      setNamespaces(data as K8sNamespace[])
    } finally {
      setLoading(false)
    }
  }, [sid])

  const loadSecrets = useCallback(async () => {
    if (!sid) return
    setLoading(true)
    try {
      const data = await window.monitcAPI.k8sManage.listSecrets(sid, selectedNs)
      setSecrets(data as K8sSecret[])
    } finally {
      setLoading(false)
    }
  }, [sid, selectedNs])

  const loadSAs = useCallback(async () => {
    if (!sid) return
    setLoading(true)
    try {
      const data = await window.monitcAPI.k8sManage.listServiceAccounts(sid, selectedNs)
      setServiceAccounts(data as SA[])
    } finally {
      setLoading(false)
    }
  }, [sid, selectedNs])

  useEffect(() => {
    if (!sid) return
    window.monitcAPI.k8sManage.listNamespaces(sid)
      .then((data) => setNamespaces(data as K8sNamespace[]))
      .catch(console.error)
  }, [sid])

  useEffect(() => {
    if (activeTab === 'namespaces') loadNamespaces()
    else if (activeTab === 'secrets') loadSecrets()
    else if (activeTab === 'serviceaccounts') loadSAs()
  }, [activeTab, selectedNs, loadNamespaces, loadSecrets, loadSAs])

  const showResult = (success: boolean, message: string) => {
    setOpResult({ success, message })
    setTimeout(() => setOpResult(null), 4000)
  }

  const createNamespace = async () => {
    if (!nsInput.trim()) return
    const res = await window.monitcAPI.k8sManage.createNamespace(sid, nsInput.trim()) as { success: boolean; error?: string }
    showResult(res.success, res.success ? t('k8sManage.namespaceCreated', { name: nsInput }) : res.error ?? t('common.error'))
    if (res.success) { setNsInput(''); loadNamespaces() }
  }

  const deleteNamespace = async (name: string) => {
    if (!confirm(t('k8sManage.deleteNamespaceConfirm', { name }))) return
    const res = await window.monitcAPI.k8sManage.deleteNamespace(sid, name) as { success: boolean; error?: string }
    showResult(res.success, res.success ? t('k8sManage.namespaceDeleted', { name }) : res.error ?? t('common.error'))
    if (res.success) loadNamespaces()
  }

  const createSecret = async () => {
    if (!newSecretName.trim() || !newSecretKey.trim()) return
    const res = await window.monitcAPI.k8sManage.createSecretGeneric(sid, newSecretName.trim(), selectedNs, { [newSecretKey]: newSecretValue }) as { success: boolean; error?: string }
    showResult(res.success, res.success ? t('k8sManage.secretCreated', { name: newSecretName }) : res.error ?? t('common.error'))
    if (res.success) { setShowNewSecret(false); setNewSecretName(''); setNewSecretKey(''); setNewSecretValue(''); loadSecrets() }
  }

  const deleteSecret = async (name: string) => {
    if (!confirm(t('k8sManage.deleteSecretConfirm', { name }))) return
    const res = await window.monitcAPI.k8sManage.deleteSecret(sid, name, selectedNs) as { success: boolean; error?: string }
    showResult(res.success, res.success ? t('k8sManage.secretDeleted', { name }) : res.error ?? t('common.error'))
    if (res.success) loadSecrets()
  }

  const createSA = async () => {
    if (!newSAName.trim()) return
    const res = await window.monitcAPI.k8sManage.createServiceAccount(sid, newSAName.trim(), selectedNs) as { success: boolean; error?: string }
    showResult(res.success, res.success ? t('k8sManage.saCreated', { name: newSAName }) : res.error ?? t('common.error'))
    if (res.success) { setShowNewSA(false); setNewSAName(''); loadSAs() }
  }

  const loadKubeconfig = async () => {
    setLoading(true)
    try {
      const res = await window.monitcAPI.k8sManage.getKubeconfig(sid) as { success: boolean; content?: string }
      setKubeconfigContent(res.content ?? '')
    } finally {
      setLoading(false)
    }
  }

  const loadCICDKubeconfig = async () => {
    if (!server) return
    setLoading(true)
    try {
      const res = await window.monitcAPI.k8sManage.getCICDKubeconfig(sid, server.host) as { success: boolean; base64?: string }
      setKubeconfigB64(res.base64 ?? '')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const statusColor = (status: string) => {
    if (status === 'Active') return 'text-green-400 bg-green-400/10'
    if (status === 'Terminating') return 'text-red-400 bg-red-400/10'
    return 'text-slate-400 bg-slate-400/10'
  }

  if (!server) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        {t('k8sManage.noServer')}
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'namespaces', label: t('k8sManage.namespaces') },
    { id: 'secrets', label: t('k8sManage.secrets') },
    { id: 'serviceaccounts', label: t('k8sManage.serviceAccounts') },
    { id: 'kubeconfig', label: t('k8sManage.kubeconfig') }
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-[#1e1e2e]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-100">{t('k8sManage.title')}</h1>
            <p className="text-sm text-slate-400">{server.name} — {server.host}</p>
          </div>
          {opResult && (
            <div className={`text-sm px-3 py-1.5 rounded-lg ${opResult.success ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
              {opResult.message}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${activeTab === tab.id ? 'bg-[#12121c] text-indigo-300 border-t border-x border-[#1e1e2e]' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Namespaces */}
        {activeTab === 'namespaces' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                value={nsInput}
                onChange={(e) => setNsInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createNamespace()}
                placeholder={t('k8sManage.namespacePlaceholder')}
                className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70"
              />
              <button onClick={createNamespace} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white transition-colors">
                {t('k8sManage.createNamespace')}
              </button>
              <button onClick={loadNamespaces} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors">
                ↻
              </button>
            </div>
            {loading ? <Spinner /> : namespaces.length === 0 ? <EmptyState message={t('k8sManage.noNamespaces')} /> : (
              <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/40">
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.name')}</th>
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.status')}</th>
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.created')}</th>
                      <th className="py-2.5 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {namespaces.map((ns) => (
                      <tr key={ns.name} className="border-b border-slate-700/20 hover:bg-white/2">
                        <td className="py-2.5 px-4 font-mono text-slate-200">{ns.name}</td>
                        <td className="py-2.5 px-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(ns.status)}`}>{ns.status}</span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 text-xs">{new Date(ns.age).toLocaleDateString()}</td>
                        <td className="py-2.5 px-4 text-right">
                          {!['default', 'kube-system', 'kube-public', 'kube-node-lease'].includes(ns.name) && (
                            <button onClick={() => deleteNamespace(ns.name)} className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10">
                              {t('common.delete')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Secrets */}
        {activeTab === 'secrets' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <select value={selectedNs} onChange={(e) => setSelectedNs(e.target.value)} className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/70">
                {namespaces.length > 0 ? namespaces.map((n) => <option key={n.name} value={n.name}>{n.name}</option>) : <option value="default">default</option>}
              </select>
              <button onClick={() => setShowNewSecret(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white transition-colors">
                {t('k8sManage.newSecret')}
              </button>
              <button onClick={loadSecrets} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors">↻</button>
            </div>

            {showNewSecret && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200">{t('k8sManage.newGenericSecret')}</h3>
                <div className="grid grid-cols-3 gap-2">
                  <input value={newSecretName} onChange={(e) => setNewSecretName(e.target.value)} placeholder={t('k8sManage.secretName')} className="bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                  <input value={newSecretKey} onChange={(e) => setNewSecretKey(e.target.value)} placeholder={t('k8sManage.secretKey')} className="bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                  <input value={newSecretValue} onChange={(e) => setNewSecretValue(e.target.value)} placeholder={t('k8sManage.secretValue')} type="password" className="bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowNewSecret(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel')}</button>
                  <button onClick={createSecret} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white">{t('common.create')}</button>
                </div>
              </div>
            )}

            {loading ? <Spinner /> : secrets.length === 0 ? <EmptyState message={t('k8sManage.noSecrets')} /> : (
              <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/40">
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.name')}</th>
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.type')}</th>
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.created')}</th>
                      <th className="py-2.5 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {secrets.map((s) => (
                      <tr key={s.name} className="border-b border-slate-700/20 hover:bg-white/2">
                        <td className="py-2.5 px-4 font-mono text-slate-200">{s.name}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-400">{s.type}</td>
                        <td className="py-2.5 px-4 text-slate-400 text-xs">{new Date(s.age).toLocaleDateString()}</td>
                        <td className="py-2.5 px-4 text-right">
                          <button onClick={() => deleteSecret(s.name)} className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10">{t('common.delete')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Service Accounts */}
        {activeTab === 'serviceaccounts' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <select value={selectedNs} onChange={(e) => setSelectedNs(e.target.value)} className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/70">
                {namespaces.length > 0 ? namespaces.map((n) => <option key={n.name} value={n.name}>{n.name}</option>) : <option value="default">default</option>}
              </select>
              <button onClick={() => setShowNewSA(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white transition-colors">
                {t('k8sManage.newSA')}
              </button>
              <button onClick={loadSAs} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors">↻</button>
            </div>

            {showNewSA && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200">{t('k8sManage.newServiceAccount')}</h3>
                <p className="text-sm text-slate-400">{t('k8sManage.saDescription')}</p>
                <div className="flex gap-2">
                  <input value={newSAName} onChange={(e) => setNewSAName(e.target.value)} placeholder={t('k8sManage.saNamePlaceholder')} className="flex-1 bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70" />
                  <button onClick={() => setShowNewSA(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel')}</button>
                  <button onClick={createSA} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white">{t('common.create')}</button>
                </div>
              </div>
            )}

            {loading ? <Spinner /> : serviceAccounts.length === 0 ? <EmptyState message={t('k8sManage.noServiceAccounts')} /> : (
              <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/40">
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.name')}</th>
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.namespace')}</th>
                      <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400">{t('common.created')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceAccounts.map((sa) => (
                      <tr key={sa.name} className="border-b border-slate-700/20 hover:bg-white/2">
                        <td className="py-2.5 px-4 font-mono text-slate-200">{sa.name}</td>
                        <td className="py-2.5 px-4 text-slate-400">{sa.namespace}</td>
                        <td className="py-2.5 px-4 text-slate-400 text-xs">{new Date(sa.age).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Kubeconfig */}
        {activeTab === 'kubeconfig' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-slate-200">{t('k8sManage.rawKubeconfig')}</h3>
                <p className="text-xs text-slate-400">{t('k8sManage.rawKubeconfigDesc')}</p>
                <button onClick={loadKubeconfig} className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-200 transition-colors">
                  {t('k8sManage.loadKubeconfig')}
                </button>
                {kubeconfigContent && (
                  <>
                    <pre className="bg-slate-900/80 rounded-lg p-3 text-xs text-slate-300 overflow-auto max-h-60 font-mono">{kubeconfigContent}</pre>
                    <button onClick={() => copyToClipboard(kubeconfigContent)} className="w-full px-3 py-2 bg-indigo-600/80 hover:bg-indigo-600 rounded-lg text-sm text-white transition-colors">
                      {copied ? t('common.copied') : t('k8sManage.copyToClipboard')}
                    </button>
                  </>
                )}
              </div>

              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-slate-200">{t('k8sManage.cicdKubeconfig')}</h3>
                <p className="text-xs text-slate-400">{t('k8sManage.cicdKubeconfigDesc')}</p>
                <button onClick={loadCICDKubeconfig} className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm text-white transition-colors">
                  {t('k8sManage.generateCICDKubeconfig')}
                </button>
                {kubeconfigB64 && (
                  <>
                    <textarea readOnly value={kubeconfigB64} rows={5} className="w-full bg-slate-900/80 rounded-lg p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none" />
                    <button onClick={() => copyToClipboard(kubeconfigB64)} className="w-full px-3 py-2 bg-indigo-600/80 hover:bg-indigo-600 rounded-lg text-sm text-white transition-colors">
                      {copied ? t('common.copied') : t('k8sManage.copyBase64')}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-300">
              <div className="font-semibold mb-2">{t('k8sManage.howToUseTitle')}</div>
              <pre className="text-xs text-blue-200 font-mono whitespace-pre-wrap">{t('k8sManage.howToUseCode')}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
