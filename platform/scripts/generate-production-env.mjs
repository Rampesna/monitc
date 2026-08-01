import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import sodium from 'libsodium-wrappers'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'

const output = resolve(process.argv[2] || '.env.production')

try {
  await readFile(output)
  console.log(`[secrets] preserving existing ${output}`)
  process.exit(0)
} catch {
  // First install.
}

const secret = (bytes = 32) => randomBytes(bytes).toString('base64url')
const deploymentMode = process.env.DEPLOYMENT_MODE === 'self-hosted' ? 'self-hosted' : 'hosted'
const appOrigin = process.env.APP_ORIGIN || 'https://monitc.talhacan.com'
const adminOrigin = process.env.ADMIN_ORIGIN || 'https://monitcap.talhacan.com'
const apiOrigin = process.env.API_ORIGIN || 'https://monitc-api.talhacan.com'
const agentGatewayAddress = process.env.AGENT_GATEWAY_PUBLIC_ADDRESS || (
  deploymentMode === 'self-hosted' ? 'monitc-agent.example.com:443' : 'monitc-agent.talhacan.com:443'
)
const agentGatewayServerName = process.env.AGENT_GATEWAY_SERVER_NAME || agentGatewayAddress.replace(/:\d+$/, '')
const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || (
  deploymentMode === 'hosted' ? 'rampesna@gmail.com' : 'admin@monitc.local'
)
const postgresPassword = secret(30)
const redisPassword = secret(32)
const adminPassword = secret(24)
const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
const privatePem = await exportPKCS8(privateKey)
const publicPem = await exportSPKI(publicKey)
await sodium.ready
const vault = sodium.crypto_box_keypair()
const encode = (value) => Buffer.from(value).toString('base64')
const lines = [
  'NODE_ENV=production',
  'PORT=8080',
  'LOG_LEVEL=info',
  'TRUST_PROXY=true',
  `APP_ORIGIN=${appOrigin}`,
  `ADMIN_ORIGIN=${adminOrigin}`,
  `API_ORIGIN=${apiOrigin}`,
  'POSTGRES_USER=monitc',
  `POSTGRES_PASSWORD=${postgresPassword}`,
  'POSTGRES_DB=monitc',
  `DATABASE_URL=postgresql://monitc:${postgresPassword}@postgres:5432/monitc`,
  `REDIS_MODE=${deploymentMode === 'self-hosted' ? 'standalone' : 'cluster'}`,
  `REDIS_NODES=${deploymentMode === 'self-hosted'
    ? 'redis:6379'
    : 'redis-0.redis-headless:6379,redis-1.redis-headless:6379,redis-2.redis-headless:6379'}`,
  `REDIS_PASSWORD=${redisPassword}`,
  `JWT_PRIVATE_KEY_B64=${encode(privatePem)}`,
  `JWT_PUBLIC_KEY_B64=${encode(publicPem)}`,
  'JWT_KEY_ID=monitc-2026-01',
  `JWT_ISSUER=${apiOrigin}`,
  'JWT_AUDIENCE=monitc-platform',
  'ACCESS_TOKEN_TTL_SECONDS=600',
  'REFRESH_TOKEN_TTL_DAYS=30',
  `VAULT_PUBLIC_KEY_B64=${sodium.to_base64(vault.publicKey, sodium.base64_variants.ORIGINAL)}`,
  `VAULT_PRIVATE_KEY_B64=${sodium.to_base64(vault.privateKey, sodium.base64_variants.ORIGINAL)}`,
  'VAULT_KEY_ID=vault-2026-01',
  `PII_ENCRYPTION_KEY_B64=${secret(32)}`,
  `PII_INDEX_KEY_B64=${secret(32)}`,
  `PASSWORD_PEPPER=${secret(32)}`,
  'COOKIE_DOMAIN=',
  'RELEASES_PATH=/var/lib/monitc/releases',
  `AGENT_GATEWAY_PUBLIC_ADDRESS=${agentGatewayAddress}`,
  `AGENT_GATEWAY_SERVER_NAME=${agentGatewayServerName}`,
  'AGENT_CA_CERT_PATH=/var/run/monitc-agent-ca/ca.crt',
  `AGENT_INSTALL_URL=${appOrigin}/install-agent.sh`,
  'MONITC_AGENT_GATEWAY_LISTEN=:9443',
  'MONITC_AGENT_GATEWAY_STATE_DIR=/var/lib/monitc/agent-pki',
  'MONITC_AGENT_CA_CERT=/var/lib/monitc/agent-pki/ca.crt',
  'MONITC_AGENT_CA_KEY=/var/lib/monitc/agent-pki/ca.key',
  'MONITC_AGENT_SERVER_CERT=/var/lib/monitc/agent-pki/server.crt',
  'MONITC_AGENT_SERVER_KEY=/var/lib/monitc/agent-pki/server.key',
  `MONITC_AGENT_SERVER_NAMES=${agentGatewayServerName}`,
  `MONITC_AGENT_TRUST_DOMAIN=${new URL(appOrigin).hostname}`,
  'MONITC_AGENT_CERT_TTL=168h',
  'MONITC_AGENT_SAMPLE_INTERVAL=1s',
  'MONITC_AGENT_BATCH_INTERVAL=5s',
  'MONITC_AGENT_HEARTBEAT_INTERVAL=15s',
  'WORKER_POLL_SECONDS=30',
  `ALLOW_PRIVATE_TARGETS=${deploymentMode === 'self-hosted' ? 'true' : 'false'}`,
  `BOOTSTRAP_ADMIN_EMAIL=${bootstrapEmail}`,
  `BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}`
]

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${lines.join('\n')}\n`, { mode: 0o600 })
await chmod(output, 0o600)
console.log(`[secrets] generated ${output}; keep it outside version control and back it up securely`)
