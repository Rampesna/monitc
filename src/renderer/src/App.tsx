import React, { useState, useEffect, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { MainLayout } from './components/layout/MainLayout'
import { LicenseGate } from './pages/LicenseGate'
import { Dashboard } from './pages/Dashboard'
import { ServerDashboard } from './pages/ServerDashboard'
import { DockerPage } from './pages/DockerPage'
import { DockerDetail } from './pages/DockerDetail'
import { KubernetesPage } from './pages/KubernetesPage'
import { KubernetesPodDetail } from './pages/KubernetesPodDetail'
import { LogViewer } from './pages/LogViewer'
import { AlertsPage } from './pages/AlertsPage'
import { SettingsLayout } from './pages/Settings/SettingsLayout'
import { Spinner } from './components/common/Spinner'

const K8sManagePage = lazy(() => import('./pages/K8sManagePage'))
const CICDPage = lazy(() => import('./pages/CICDPage'))
const DeployPage = lazy(() => import('./pages/DeployPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <Spinner size="lg" className="text-indigo-400" />
    </div>
  )
}

function AppInner(): React.ReactElement {
  const { state, dispatch } = useApp()
  const [licenseVerified, setLicenseVerified] = useState(false)
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseIsNew, setLicenseIsNew] = useState(false)
  const [licenseInfoLoaded, setLicenseInfoLoaded] = useState(false)

  useEffect(() => {
    window.monitcAPI.app.getLicenseInfo().then(({ key, isNew }) => {
      setLicenseKey(key)
      setLicenseIsNew(isNew)
      setLicenseInfoLoaded(true)
    }).catch(console.error)
  }, [])

  if (state.isLoading || !licenseInfoLoaded) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" className="text-indigo-400" />
          <p className="text-slate-400 text-sm">Yükleniyor...</p>
        </div>
      </div>
    )
  }

  if (!licenseVerified) {
    return (
      <LicenseGate
        licenseKey={licenseKey}
        isNew={licenseIsNew}
        onContinue={() => {
          setLicenseVerified(true)
          dispatch({ type: 'SET_LICENSE', key: licenseKey, isNew: false })
        }}
      />
    )
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="server/:serverId" element={<ServerDashboard />} />
          <Route path="docker" element={<DockerPage />} />
          <Route path="docker/:serverId" element={<DockerPage />} />
          <Route path="docker/:serverId/:containerId" element={<DockerDetail />} />
          <Route path="kubernetes" element={<KubernetesPage />} />
          <Route path="kubernetes/:serverId" element={<KubernetesPage />} />
          <Route path="kubernetes/:serverId/:namespace/:podName" element={<KubernetesPodDetail />} />
          <Route path="k8s-manage" element={<Suspense fallback={<PageLoader />}><K8sManagePage /></Suspense>} />
          <Route path="cicd" element={<Suspense fallback={<PageLoader />}><CICDPage /></Suspense>} />
          <Route path="deploy" element={<Suspense fallback={<PageLoader />}><DeployPage /></Suspense>} />
          <Route path="logs" element={<LogViewer />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="settings" element={<SettingsLayout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default function App(): React.ReactElement {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}
