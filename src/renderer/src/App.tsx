import React, { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { MainLayout } from './components/layout/MainLayout'
import { Dashboard } from './pages/Dashboard'
import { ServersPage } from './pages/ServersPage'
import { ServerDashboard } from './pages/ServerDashboard'
import { DockerPage } from './pages/DockerPage'
import { DockerDetail } from './pages/DockerDetail'
import { KubernetesPage } from './pages/KubernetesPage'
import { KubernetesPodDetail } from './pages/KubernetesPodDetail'
import { LogViewer } from './pages/LogViewer'
import { AlertsPage } from './pages/AlertsPage'
import { SettingsLayout } from './pages/Settings/SettingsLayout'
import { Skeleton } from './components/common/Skeleton'

const K8sManagePage = lazy(() => import('./pages/K8sManagePage'))
const CICDPage = lazy(() => import('./pages/CICDPage'))
const DeployPage = lazy(() => import('./pages/DeployPage'))
const TerminalPage = lazy(() => import('./pages/TerminalPage'))
const SftpPage = lazy(() => import('./pages/SftpPage'))

function PageLoader() {
  return (
    <div className="route-skeleton" aria-label="Loading">
      <div className="route-skeleton-heading"><Skeleton rounded="lg" /><div><Skeleton /><Skeleton /></div></div>
      <div className="route-skeleton-toolbar"><Skeleton /><Skeleton /><Skeleton /></div>
      <div className="route-skeleton-surface">{Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} />)}</div>
    </div>
  )
}

function AppInner(): React.ReactElement {
  const { state } = useApp()

  if (state.isLoading) {
    return (
      <div className="app-boot-skeleton" aria-label="Loading monitc">
        <header><span className="sidebar-brand-mark"><span className="sidebar-brand-glyph" /></span><Skeleton className="w-36 h-2.5" /><Skeleton className="w-28 h-2.5" /></header>
        <aside><span className="sidebar-brand-mark"><span className="sidebar-brand-glyph" /></span>{Array.from({ length: 9 }).map((_, index) => <Skeleton rounded="lg" key={index} />)}</aside>
        <main><Skeleton className="w-24 h-2.5" /><Skeleton className="w-64 h-7" /><div>{Array.from({ length: 4 }).map((_, index) => <section key={index}><Skeleton className="w-28 h-2.5" /><Skeleton rounded="lg" className="flex-1 w-full" /></section>)}</div></main>
      </div>
    )
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="servers" element={<ServersPage />} />
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
          <Route path="terminal" element={<Suspense fallback={<PageLoader />}><TerminalPage /></Suspense>} />
          <Route path="sftp" element={<Suspense fallback={<PageLoader />}><SftpPage /></Suspense>} />
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
