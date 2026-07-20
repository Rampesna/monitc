import React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Bell, Plus, Sparkles } from 'lucide-react'
import { Card } from '../../components/common/Card'
import { Button } from '../../components/common/Button'
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
    <div className="alert-template-page">
      <div className="settings-section-header alert-template-header">
        <div className="settings-section-title">
          <span><Bell size={15} /></span>
          <div><h2>{t('alertRulesTab.title')}</h2><p>{t('alertRulesTab.subtitle')}</p></div>
        </div>
        <div className="alert-template-count"><Sparkles size={12} /> {ALERT_TEMPLATES.length} templates</div>
      </div>

      <div className="alert-template-grid">
        {ALERT_TEMPLATES.map((tpl, index) => {
          const metric = METRIC_TYPES.find((m) => m.value === tpl.metric)
          const tone = ['violet', 'cyan', 'mint', 'rose'][index % 4]
          return (
            <Card key={tpl.id} className={`alert-template-card tone-${tone}`}>
              <div className="alert-template-top">
                <div className="alert-template-icon"><Activity size={15} /></div>
                <div className="alert-template-name">
                  <span>{tpl.name}</span>
                  <small>{metric?.label}</small>
                </div>
                <Button variant="ghost" size="sm" icon={<Plus size={12} />} onClick={() => applyTemplate(tpl)}>
                  {t('alertRulesTab.add')}
                </Button>
              </div>
              <div className="alert-template-condition">
                {isEventMetric(tpl.metric) ? (
                  <><strong>SSH offline</strong><span>for {tpl.durationSeconds}s</span></>
                ) : (
                  <><strong>{tpl.operator === 'gt' ? '>' : tpl.operator === 'lt' ? '<' : '='} {tpl.threshold}</strong><span>for {tpl.durationSeconds}s</span></>
                )}
              </div>
              <div className="alert-template-footer"><span>Cooldown</span><b>{tpl.cooldownMinutes}m</b></div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
