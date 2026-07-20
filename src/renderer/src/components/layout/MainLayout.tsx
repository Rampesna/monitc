import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { UpdateToast } from '../updater/UpdateToast'

export function MainLayout(): React.ReactElement {
  return (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden">
      <UpdateToast />
      <Header />
      <div className="app-workspace flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="app-page flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
