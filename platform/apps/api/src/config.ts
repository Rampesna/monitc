import 'dotenv/config'
import { z } from 'zod'

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: booleanString,
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  ADMIN_ORIGIN: z.url().default('http://localhost:5174'),
  API_ORIGIN: z.url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1),
  REDIS_MODE: z.enum(['cluster', 'standalone']).default('cluster'),
  REDIS_NODES: z.string().min(1),
  REDIS_PASSWORD: z.string().min(16),
  JWT_PRIVATE_KEY_B64: z.string().min(1),
  JWT_PUBLIC_KEY_B64: z.string().min(1),
  JWT_KEY_ID: z.string().min(1).default('monitc-2026-01'),
  JWT_ISSUER: z.url(),
  JWT_AUDIENCE: z.string().min(1).default('monitc-platform'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  VAULT_PUBLIC_KEY_B64: z.string().min(1),
  VAULT_PRIVATE_KEY_B64: z.string().min(1),
  VAULT_KEY_ID: z.string().min(1).default('vault-2026-01'),
  PII_ENCRYPTION_KEY_B64: z.string().min(43),
  PII_INDEX_KEY_B64: z.string().min(43),
  PASSWORD_PEPPER: z.string().default(''),
  COOKIE_DOMAIN: z.string().default(''),
  RELEASES_PATH: z.string().default('/var/lib/monitc/releases'),
  AGENT_GATEWAY_PUBLIC_ADDRESS: z.string().min(3).default('monitc-agent.talhacan.com:443'),
  AGENT_GATEWAY_SERVER_NAME: z.string().min(1).default('monitc-agent.talhacan.com'),
  AGENT_CA_CERT_PATH: z.string().default('/var/run/monitc-agent-ca/ca.crt'),
  AGENT_INSTALL_URL: z.url().default('https://monitc.talhacan.com/install-agent.sh'),
  PASSKEY_RP_ID: z.string().min(1).default('monitc.talhacan.com'),
  PASSKEY_RP_NAME: z.string().min(1).default('Monitc'),
  PASSKEY_ORIGINS: z.string().min(1).default('https://monitc.talhacan.com'),
  APPLE_BUNDLE_ID: z.string().min(1).default('com.monitc.mobile'),
  APPLE_APP_ID: z.string().default(''),
  APPLE_ROOT_CA_B64: z.string().default(''),
  GOOGLE_CLIENT_IDS: z.string().default(''),
  BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(16).optional(),
  WORKER_POLL_SECONDS: z.coerce.number().int().min(10).max(300).default(30),
  ALLOW_PRIVATE_TARGETS: booleanString
})

const parsed = configSchema.safeParse(process.env)

if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
  throw new Error(`Invalid monitc API configuration: ${fields}`)
}

export const config = parsed.data
export type Config = typeof config
