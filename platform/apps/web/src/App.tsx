import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context'
import { AppShell } from './components/AppShell'

const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })))
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })))
const ServersPage = lazy(() => import('./pages/ServersPage').then((module) => ({ default: module.ServersPage })))
const ServerDetailPage = lazy(() => import('./pages/ServerDetailPage').then((module) => ({ default: module.ServerDetailPage })))
const WorkloadsPage = lazy(() => import('./pages/WorkloadsPage').then((module) => ({ default: module.WorkloadsPage })))
const SessionsPage = lazy(() => import('./pages/SessionsPage').then((module) => ({ default: module.SessionsPage })))
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((module) => ({ default: module.AlertsPage })))
const BillingPage = lazy(() => import('./pages/BillingPage').then((module) => ({ default: module.BillingPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

function RouteFallback() {
  return <div className="route-loading"><span className="button-spinner" /><p>Opening workspace…</p></div>
}

function ProtectedShell() {
  const { ready, user } = useAuth()
  const location = useLocation()
  if (!ready) return <div className="app-boot"><span className="logo-mark"><i /></span><div className="boot-line" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword && location.pathname !== '/settings') {
    return <Navigate to="/settings?password=required" replace />
  }
  return <AppShell />
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route element={<ProtectedShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="servers" element={<ServersPage />} />
          <Route path="servers/:serverId" element={<ServerDetailPage />} />
          <Route path="workloads" element={<WorkloadsPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
