import { useState } from 'react'
import { ArrowRight, Check, CircleCheck, Crown, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { PLANS, type PlanCode } from '@monitc/shared'
import { useAuth } from '../context'
import { api, jsonBody } from '../lib/api'

export function BillingPage() {
  const { workspace } = useAuth()
  const [requested, setRequested] = useState<PlanCode | null>(null)
  const [busy, setBusy] = useState<PlanCode | null>(null)
  const [message, setMessage] = useState('')

  const requestPlan = async (planCode: PlanCode) => {
    if (planCode === 'community' || planCode === workspace?.plan.code) return
    setBusy(planCode)
    setMessage('')
    try {
      await api('/api/v1/plans/contact', {
        method: 'POST',
        ...jsonBody({ planCode, message: `Interested in the ${planCode} plan.` })
      })
      setRequested(planCode)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit request.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page billing-page">
      <div className="page-title centered">
        <div><p className="eyebrow">SIMPLE, MANUAL ACTIVATION</p><h1>Choose the workspace that fits.</h1><p>No automated payment yet. Select a plan and we will contact you to activate it personally.</p></div>
      </div>
      <div className="billing-status"><span><ShieldCheck size={16} /></span><div><strong>Current plan: {workspace?.plan.name}</strong><p>Your workspace remains active while we handle upgrades manually.</p></div><span className="current-plan-badge">Active</span></div>
      <section className="pricing-grid">
        {PLANS.map((plan) => {
          const current = workspace?.plan.code === plan.code
          const wasRequested = requested === plan.code
          return (
            <article className={`pricing-card ${plan.highlighted ? 'highlighted' : ''} ${current ? 'current' : ''}`} key={plan.code}>
              {plan.highlighted && <span className="popular-label"><Sparkles size={11} /> Most focused</span>}
              <header><span className="plan-icon">{plan.code === 'scale' ? <Crown size={18} /> : <ShieldCheck size={18} />}</span><div><h2>{plan.name}</h2><p>{plan.description}</p></div></header>
              <div className="plan-price">{plan.monthlyPrice === null ? <strong>Custom</strong> : <><strong>${plan.monthlyPrice}</strong><span>/ month</span></>}</div>
              <ul>{plan.features.map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
              <button
                className={current ? 'secondary-button' : 'primary-button'}
                disabled={current || wasRequested || busy === plan.code}
                onClick={() => void requestPlan(plan.code)}
              >
                {current ? <><CircleCheck size={14} /> Current plan</> : wasRequested ? <><Mail size={14} /> We’ll contact you</> : busy === plan.code ? <span className="button-spinner" /> : <>Request {plan.name} <ArrowRight size={14} /></>}
              </button>
            </article>
          )
        })}
      </section>
      {message && <p className="form-error centered-error">{message}</p>}
      <section className="contact-panel"><span><Mail size={19} /></span><div><strong>What happens after you request a plan?</strong><p>Your request appears in the monitc admin desk. We contact you, confirm the scope and activate the package manually—there is no card form or surprise charge.</p></div><a href="mailto:rampesna@gmail.com">Contact directly <ArrowRight size={13} /></a></section>
    </div>
  )
}
