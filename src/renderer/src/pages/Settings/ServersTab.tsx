import React, { useState } from 'react'
import { Edit2, Plus, Server, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { StatusDot } from '../../components/common/StatusDot'
import { ServerFormModal } from '../../components/servers/ServerFormModal'
import { useApp } from '../../context/AppContext'
import type { Server as ServerType } from '../../lib/types'

export function ServersTab(): React.ReactElement {
  const { t } = useTranslation()
  const { state, refreshServers } = useApp()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServerType | null>(null)

  const openForm = (server?: ServerType): void => {
    setEditing(server ?? null)
    setModalOpen(true)
  }

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(t('serversTab.deleteConfirm', { name }))) return
    await window.monitcAPI.servers.remove(id)
    await refreshServers()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-100">{t('serversTab.title')}</h2>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => openForm()}>{t('serversTab.addServer')}</Button>
      </div>

      {state.servers.length === 0 ? (
        <Card className="text-center py-10">
          <Server size={28} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">{t('serversTab.noServers')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {state.servers.map((server) => (
            <Card key={server.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center"><Server size={14} className="text-indigo-400" /></div>
                <div>
                  <p className="text-sm font-medium text-slate-200">{server.name}</p>
                  <p className="text-xs text-slate-500">{server.username}@{server.host}:{server.port} · {server.authType}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status={state.connectionStatuses[server.id] ?? 'disconnected'} showLabel />
                <button onClick={() => openForm(server)} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200" title={t('common.edit')}><Edit2 size={13} /></button>
                <button onClick={() => handleDelete(server.id, server.name)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400" title={t('common.delete')}><Trash2 size={13} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ServerFormModal open={modalOpen} server={editing} onClose={() => setModalOpen(false)} />
    </div>
  )
}
