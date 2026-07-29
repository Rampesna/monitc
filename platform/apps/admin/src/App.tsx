import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context'
import { Shell } from './components/Shell'
import { LoginPage } from './pages/LoginPage'
import { PasswordGate } from './components/PasswordGate'

const OverviewPage = lazy(() => import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })))
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage').then((module) => ({ default: module.WorkspacesPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((module) => ({ default: module.UsersPage })))
const RequestsPage = lazy(() => import('./pages/RequestsPage').then((module) => ({ default: module.RequestsPage })))
const ReleasesPage = lazy(() => import('./pages/ReleasesPage').then((module) => ({ default: module.ReleasesPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then((module) => ({ default: module.AuditPage })))

function Protected() {
  const { ready, user } = useAuth()
  if (!ready) return <div className="ops-boot"><i><b /></i><span /></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <PasswordGate />
  return <Shell />
}

export function App() {
  return <Suspense fallback={<div className="ops-boot"><i><b /></i><span /></div>}><Routes><Route path="/login" element={<LoginPage />} /><Route element={<Protected />}><Route index element={<OverviewPage />} /><Route path="workspaces" element={<WorkspacesPage />} /><Route path="users" element={<UsersPage />} /><Route path="requests" element={<RequestsPage />} /><Route path="releases" element={<ReleasesPage />} /><Route path="audit" element={<AuditPage />} /></Route><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense>
}
