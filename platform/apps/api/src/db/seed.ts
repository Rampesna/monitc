import { PLANS } from '@monitc/shared'
import { db } from './pool.js'

export async function seedPlans(): Promise<void> {
  for (const plan of PLANS) {
    await db.query(
      `INSERT INTO plans (code, name, description, monthly_price_cents, entitlements)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         monthly_price_cents = EXCLUDED.monthly_price_cents,
         entitlements = EXCLUDED.entitlements,
         updated_at = now()`,
      [
        plan.code,
        plan.name,
        plan.description,
        plan.monthlyPrice === null ? null : Math.round(plan.monthlyPrice * 100),
        JSON.stringify(plan.entitlements)
      ]
    )
  }
}
