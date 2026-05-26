import React from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Plus } from 'lucide-react'
import { Card } from '../../components/common/Card'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { useApp } from '../../context/AppContext'
import { ALERT_TEMPLATES, METRIC_TYPES, isEventMetric } from '../../lib/constants'
import { useNavigate } from 'react-router-dom'

export function AlertRulesTab(): React.ReactElement {
  const { t } = useTranslation()
  const { state } = useApp()
  const navigate = useNavigate()

  const applyTemplate = async (tpl: typeof ALERT_TEMPLATES[0]): Promise<void> => {
    if (!state.servers[0]) {
      alert(t('serversTab.noServers'))
      return
    }
    await window.monitcAPI.alerts.add({
      name: tpl.name,
      serverId: state.servers[0].id,
      metric: tpl.metric as never,
      operator: tpl.operator as never,
      threshold: tpl.threshold,
      durationSeconds: tpl.durationSeconds,
      channels: ['smtp'],
      recipients: [],
      cooldownMinutes: tpl.cooldownMinutes,
      enabled: true
    })
    navigate('/alerts')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Bell size={16} className="text-indigo-400" />
        <h2 className="text-base font-semibold text-slate-100">{t('alertRulesTab.title')}</h2>
      </div>

      <p className="text-sm text-slate-400">{t('alertRulesTab.subtitle')}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ALERT_TEMPLATES.map((tpl) => {
          const metric = METRIC_TYPES.find((m) => m.value === tpl.metric)
          return (
            <Card key={tpl.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell size={14} className="text-amber-400" />
                  <span className="text-sm font-semibold text-slate-200">{tpl.name}</span>
                </div>
                <Badge variant="warning">{t('alertRulesTab.add')}</Badge>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <div>Metric: <span className="text-slate-300">{metric?.label}</span></div>
                {isEventMetric(tpl.metric) ? (
                  <div>Condition: <span className="text-slate-300">SSH kesilince, {tpl.durationSeconds}s sonra</span></div>
                ) : (
                  <div>Condition: <span className="text-slate-300">{tpl.operator === 'gt' ? '>' : tpl.operator === 'lt' ? '<' : '='} {tpl.threshold}</span></div>
                )}
                <div>Duration: <span className="text-slate-300">{tpl.durationSeconds}s</span> · Cooldown: <span className="text-slate-300">{tpl.cooldownMinutes}m</span></div>
              </div>
              <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => applyTemplate(tpl)}>
                {t('alertRulesTab.add')}
              </Button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
