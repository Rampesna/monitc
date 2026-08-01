import { posix as path } from 'node:path'
import type { ClientChannel, FileEntryWithStats, Stats, SFTPWrapper } from 'ssh2'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireScope } from '../auth/guard.js'
import { config } from '../config.js'
import { db } from '../db/pool.js'
import { redis } from '../lib/redis.js'
import { decryptVaultSecret } from '../lib/vault.js'
import { normalizeWorkloadCommandError } from '../lib/workload-error.js'
import { audit } from '../services/audit.js'
import { SshConnection } from '../services/ssh-collector.js'

const idSchema = z.uuid()
const pathSchema = z.string().min(1).max(4096)
const ticketSchema = z.object({ capability: z.literal('terminal') })
const contentSchema = z.object({ path: pathSchema, content: z.string().max(2 * 1024 * 1024) })
const folderSchema = z.object({ path: pathSchema })
const moveSchema = z.object({ source: pathSchema, target: pathSchema })
const workloadNameSchema = z.string().min(1).max(253).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
const workloadLogsQuerySchema = z.object({
  tail: z.coerce.number().int().min(20).max(2_000).default(500),
  container: workloadNameSchema.optional(),
  previous: z.union([z.literal('true'), z.literal('false')]).default('false').transform((value) => value === 'true')
})
const dockerActionSchema = z.object({ action: z.enum(['start', 'stop', 'restart']) })
const podActionSchema = z.object({ action: z.literal('restart') })

interface ServerSecretRow {
  id: string
  secret_ciphertext: string | null
  secret_key_id: string | null
  entitlements: Record<string, unknown>
}

function safePath(value: string): string {
  if (value.includes('\u0000')) throw new Error('INVALID_PATH')
  return path.normalize(value.startsWith('/') ? value : `/${value}`)
}

async function loadServer(
  serverId: string,
  workspaceId: string
): Promise<ServerSecretRow | null> {
  const result = await db.query<ServerSecretRow>(
    `SELECT sc.id, sc.secret_ciphertext, sc.secret_key_id, p.entitlements
     FROM server_connections sc
     JOIN subscriptions s ON s.workspace_id = sc.workspace_id AND s.status IN ('active', 'trialing', 'grace_period')
     JOIN plans p ON p.code = s.plan_code
     WHERE sc.id = $1 AND sc.workspace_id = $2`,
    [serverId, workspaceId]
  )
  return result.rows[0] || null
}

async function withSftp<T>(
  server: ServerSecretRow,
  operation: (sftp: SFTPWrapper, connection: SshConnection) => Promise<T>
): Promise<T> {
  const secret = await decryptVaultSecret(...requiredSshSecret(server))
  const connection = await SshConnection.connect(secret)
  try {
    const sftp = await connection.sftp()
    return await operation(sftp, connection)
  } finally {
    connection.close()
  }
}

function requiredSshSecret(server: ServerSecretRow): [string, string] {
  if (!server.secret_ciphertext || !server.secret_key_id) {
    const error = new Error('SSH fallback is not configured for this agent connection.') as Error & { statusCode: number }
    error.statusCode = 409
    throw error
  }
  return [server.secret_ciphertext, server.secret_key_id]
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

async function withSsh<T>(
  server: ServerSecretRow,
  operation: (connection: SshConnection) => Promise<T>
): Promise<T> {
  const secret = await decryptVaultSecret(...requiredSshSecret(server))
  const connection = await SshConnection.connect(secret)
  try {
    return await operation(connection)
  } finally {
    connection.close()
  }
}

async function withWorkloadSsh<T>(
  server: ServerSecretRow,
  operation: (connection: SshConnection) => Promise<T>
): Promise<T> {
  try {
    return await withSsh(server, operation)
  } catch (error) {
    throw normalizeWorkloadCommandError(error)
  }
}

function kubectl(command: string): string {
  return `export PATH="$PATH:/usr/local/bin:/usr/local/sbin"; export KUBECONFIG="\${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"; if command -v kubectl >/dev/null 2>&1; then kubectl ${command}; elif command -v k3s >/dev/null 2>&1; then k3s kubectl ${command}; else echo 'kubectl is not available' >&2; exit 127; fi`
}

function publicContainerInspection(value: unknown): Record<string, unknown> {
  const inspected = Array.isArray(value) ? value[0] : value
  if (!inspected || typeof inspected !== 'object') return {}
  const source = inspected as Record<string, unknown>
  const config = (source.Config && typeof source.Config === 'object' ? source.Config : {}) as Record<string, unknown>
  const host = (source.HostConfig && typeof source.HostConfig === 'object' ? source.HostConfig : {}) as Record<string, unknown>
  const network = (source.NetworkSettings && typeof source.NetworkSettings === 'object' ? source.NetworkSettings : {}) as Record<string, unknown>
  const state = (source.State && typeof source.State === 'object' ? source.State : {}) as Record<string, unknown>
  const health = (state.Health && typeof state.Health === 'object' ? state.Health : {}) as Record<string, unknown>
  return {
    id: source.Id,
    name: source.Name,
    created: source.Created,
    image: config.Image,
    platform: source.Platform,
    driver: source.Driver,
    state: {
      status: state.Status,
      running: state.Running,
      paused: state.Paused,
      restarting: state.Restarting,
      oomKilled: state.OOMKilled,
      dead: state.Dead,
      pid: state.Pid,
      exitCode: state.ExitCode,
      error: state.Error,
      startedAt: state.StartedAt,
      finishedAt: state.FinishedAt,
      health: health.Status ? { status: health.Status, failingStreak: health.FailingStreak } : null
    },
    restartCount: source.RestartCount,
    workingDirectory: config.WorkingDir,
    exposedPorts: config.ExposedPorts,
    restartPolicy: host.RestartPolicy,
    resources: {
      memory: host.Memory,
      memoryReservation: host.MemoryReservation,
      nanoCpus: host.NanoCpus,
      cpuShares: host.CpuShares
    },
    ports: network.Ports,
    networks: network.Networks
  }
}

function lstat(sftp: SFTPWrapper, target: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.lstat(target, (error, stats) => (error ? reject(error) : resolve(stats)))
  })
}

function readdir(sftp: SFTPWrapper, target: string): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(target, (error, list) => (error ? reject(error) : resolve(list)))
  })
}

function mkdir(sftp: SFTPWrapper, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(target, { mode: 0o755 }, (error) => (error ? reject(error) : resolve()))
  })
}

function rename(sftp: SFTPWrapper, source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(source, target, (error) => (error ? reject(error) : resolve()))
  })
}

function unlink(sftp: SFTPWrapper, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(target, (error) => (error ? reject(error) : resolve()))
  })
}

function rmdir(sftp: SFTPWrapper, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(target, (error) => (error ? reject(error) : resolve()))
  })
}

async function removeRecursive(sftp: SFTPWrapper, target: string): Promise<void> {
  const details = await lstat(sftp, target)
  if (!details.isDirectory()) {
    await unlink(sftp, target)
    return
  }
  const entries = await readdir(sftp, target) as Array<{ filename: string }>
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue
    await removeRecursive(sftp, path.join(target, entry.filename))
  }
  await rmdir(sftp, target)
}

function readText(sftp: SFTPWrapper, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.readFile(target, { encoding: 'utf8' }, (error, data) => {
      if (error) reject(error)
      else resolve(String(data))
    })
  })
}

function writeText(sftp: SFTPWrapper, target: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(target, content, { encoding: 'utf8', mode: 0o640 }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function copyEntry(sftp: SFTPWrapper, source: string, target: string): Promise<void> {
  const details = await lstat(sftp, source)
  if (details.isDirectory()) {
    await mkdir(sftp, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const entries = await readdir(sftp, source) as Array<{ filename: string }>
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue
      await copyEntry(sftp, path.join(source, entry.filename), path.join(target, entry.filename))
    }
    return
  }
  await new Promise<void>((resolve, reject) => {
    const input = sftp.createReadStream(source)
    const output = sftp.createWriteStream(target, { mode: details.mode & 0o777 })
    input.once('error', reject)
    output.once('error', reject)
    output.once('close', resolve)
    input.pipe(output)
  })
}

async function parseServerRequest(request: FastifyRequest) {
  const auth = request.auth
  if (!auth) return null
  const parsed = idSchema.safeParse((request.params as { id?: string }).id)
  if (!parsed.success) return null
  return loadServer(parsed.data, auth.workspaceId)
}

export async function accessRoutes(app: FastifyInstance): Promise<void> {
  app.post('/:id/access-ticket', { preHandler: requireScope('terminal:use') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const input = ticketSchema.safeParse(request.body)
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!input.success || !id.success) return reply.code(400).send({ error: 'validation_error' })
    const server = await loadServer(id.data, request.auth.workspaceId)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.webTerminal) {
      return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'webTerminal' })
    }
    if (!server.secret_ciphertext || !server.secret_key_id) {
      return reply.code(409).send({ error: 'ssh_fallback_not_configured' })
    }
    const ticket = crypto.randomUUID()
    await redis.set(
      `access-ticket:${ticket}`,
      JSON.stringify({
        userId: request.auth.userId,
        workspaceId: request.auth.workspaceId,
        serverId: id.data,
        capability: input.data.capability
      }),
      'EX',
      30,
      'NX'
    )
    return { ticket, expiresIn: 30 }
  })

  app.get('/:id/workloads/docker/:containerId/logs', { preHandler: requireScope('workloads:read') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.workloadLogs) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'workloadLogs' })
    const params = z.object({ containerId: workloadNameSchema }).safeParse(request.params)
    const query = workloadLogsQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' })
    const output = await withWorkloadSsh(server, (connection) => connection.exec(
      `docker logs --timestamps --tail ${query.data.tail} ${shellQuote(params.data.containerId)} 2>&1 | head -c 2097152`,
      25_000
    ))
    reply.header('cache-control', 'no-store')
    return { output, fetchedAt: new Date().toISOString() }
  })

  app.get('/:id/workloads/docker/:containerId/inspect', { preHandler: requireScope('workloads:read') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.workloadLogs) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'workloadLogs' })
    const params = z.object({ containerId: workloadNameSchema }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'validation_error' })
    const output = await withWorkloadSsh(server, (connection) => connection.exec(
      `docker inspect ${shellQuote(params.data.containerId)}`,
      20_000
    ))
    return { details: publicContainerInspection(JSON.parse(output)) }
  })

  app.post('/:id/workloads/docker/:containerId/action', { preHandler: requireScope('workloads:operate') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.workloadActions) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'workloadActions' })
    const params = z.object({ containerId: workloadNameSchema }).safeParse(request.params)
    const input = dockerActionSchema.safeParse(request.body)
    if (!params.success || !input.success) return reply.code(400).send({ error: 'validation_error' })
    const output = await withWorkloadSsh(server, (connection) => connection.exec(
      `docker ${input.data.action} ${shellQuote(params.data.containerId)}`,
      30_000
    ))
    await audit({
      workspaceId: request.auth!.workspaceId,
      actorUserId: request.auth!.userId,
      action: `workload.docker_${input.data.action}`,
      resourceType: 'docker_container',
      resourceId: params.data.containerId,
      metadata: { serverId: server.id }
    })
    return { ok: true, output: output.trim() }
  })

  app.get('/:id/workloads/kubernetes/:namespace/:pod/logs', { preHandler: requireScope('workloads:read') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.workloadLogs) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'workloadLogs' })
    const params = z.object({ namespace: workloadNameSchema, pod: workloadNameSchema }).safeParse(request.params)
    const query = workloadLogsQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' })
    const container = query.data.container ? ` -c ${shellQuote(query.data.container)}` : ''
    const previous = query.data.previous ? ' --previous' : ''
    const output = await withWorkloadSsh(server, (connection) => connection.exec(kubectl(
      `logs -n ${shellQuote(params.data.namespace)} ${shellQuote(params.data.pod)}${container}${previous} --timestamps --tail=${query.data.tail} | head -c 2097152`
    ), 25_000))
    reply.header('cache-control', 'no-store')
    return { output, fetchedAt: new Date().toISOString() }
  })

  app.get('/:id/workloads/kubernetes/:namespace/:pod/describe', { preHandler: requireScope('workloads:read') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.workloadLogs) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'workloadLogs' })
    const params = z.object({ namespace: workloadNameSchema, pod: workloadNameSchema }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'validation_error' })
    const output = await withWorkloadSsh(server, (connection) => connection.exec(kubectl(
      `describe pod -n ${shellQuote(params.data.namespace)} ${shellQuote(params.data.pod)}`
    ), 25_000))
    return { output }
  })

  app.post('/:id/workloads/kubernetes/:namespace/:pod/action', { preHandler: requireScope('workloads:operate') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.workloadActions) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'workloadActions' })
    const params = z.object({ namespace: workloadNameSchema, pod: workloadNameSchema }).safeParse(request.params)
    const input = podActionSchema.safeParse(request.body)
    if (!params.success || !input.success) return reply.code(400).send({ error: 'validation_error' })
    const output = await withWorkloadSsh(server, (connection) => connection.exec(kubectl(
      `delete pod -n ${shellQuote(params.data.namespace)} ${shellQuote(params.data.pod)} --wait=false`
    ), 30_000))
    await audit({
      workspaceId: request.auth!.workspaceId,
      actorUserId: request.auth!.userId,
      action: 'workload.kubernetes_restart',
      resourceType: 'kubernetes_pod',
      resourceId: `${params.data.namespace}/${params.data.pod}`,
      metadata: { serverId: server.id }
    })
    return { ok: true, output: output.trim() }
  })

  app.get('/:id/files', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const query = z.object({ path: pathSchema.default('/') }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'validation_error' })
    const target = safePath(query.data.path)
    const entries = await withSftp(server, async (sftp) => {
      const list = await readdir(sftp, target) as Array<{
        filename: string
        longname: string
        attrs: Stats
      }>
      return list
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry) => ({
          name: entry.filename,
          path: path.join(target, entry.filename),
          type: entry.attrs.isDirectory() ? 'directory' : entry.attrs.isSymbolicLink() ? 'symlink' : 'file',
          size: entry.attrs.size,
          mode: entry.attrs.mode & 0o777,
          modifiedAt: new Date(entry.attrs.mtime * 1000).toISOString()
        }))
        .sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))
    })
    return { path: target, entries }
  })

  app.get('/:id/files/content', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const query = z.object({ path: pathSchema }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'validation_error' })
    const target = safePath(query.data.path)
    const content = await withSftp(server, async (sftp) => {
      const details = await lstat(sftp, target)
      if (details.size > 2 * 1024 * 1024) throw new Error('FILE_TOO_LARGE_FOR_EDITOR')
      return readText(sftp, target)
    })
    return { path: target, content }
  })

  app.put('/:id/files/content', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const input = contentSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'validation_error' })
    await withSftp(server, (sftp) => writeText(sftp, safePath(input.data.path), input.data.content))
    return reply.code(204).send()
  })

  app.post('/:id/files/folder', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const input = folderSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'validation_error' })
    await withSftp(server, (sftp) => mkdir(sftp, safePath(input.data.path)))
    return reply.code(201).send({ ok: true })
  })

  app.post('/:id/files/move', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const input = moveSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'validation_error' })
    await withSftp(server, (sftp) => rename(sftp, safePath(input.data.source), safePath(input.data.target)))
    return { ok: true }
  })

  app.post('/:id/files/copy', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const input = moveSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'validation_error' })
    await withSftp(server, (sftp) => copyEntry(sftp, safePath(input.data.source), safePath(input.data.target)))
    return { ok: true }
  })

  app.delete('/:id/files', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const query = z.object({ path: pathSchema }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'validation_error' })
    const target = safePath(query.data.path)
    if (target === '/') return reply.code(400).send({ error: 'root_delete_blocked' })
    await withSftp(server, (sftp) => removeRecursive(sftp, target))
    return reply.code(204).send()
  })

  app.get('/:id/files/download', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const query = z.object({ path: pathSchema }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'validation_error' })
    const target = safePath(query.data.path)
    const secret = await decryptVaultSecret(...requiredSshSecret(server))
    const connection = await SshConnection.connect(secret)
    try {
      const sftp = await connection.sftp()
      const details = await lstat(sftp, target)
      if (details.isDirectory()) {
        connection.close()
        return reply.code(400).send({ error: 'directory_download_not_supported' })
      }
      const stream = sftp.createReadStream(target)
      stream.once('close', () => connection.close())
      stream.once('error', () => connection.close())
      reply.header('content-type', 'application/octet-stream')
      reply.header('content-length', details.size)
      reply.header('content-disposition', `attachment; filename="${basenameForHeader(target)}"`)
      return reply.send(stream)
    } catch (error) {
      connection.close()
      throw error
    }
  })

  app.post('/:id/files/upload', { preHandler: requireScope('sftp:use') }, async (request, reply) => {
    const server = await parseServerRequest(request)
    if (!server) return reply.code(404).send({ error: 'server_not_found' })
    if (!server.entitlements.sftp) return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'sftp' })
    const query = z.object({ path: pathSchema.default('/') }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'validation_error' })
    const directory = safePath(query.data.path)
    const secret = await decryptVaultSecret(...requiredSshSecret(server))
    const connection = await SshConnection.connect(secret)
    try {
      const sftp = await connection.sftp()
      let uploaded = 0
      for await (const part of request.parts()) {
        if (part.type !== 'file') continue
        const name = path.basename(part.filename)
        if (!name || name === '.' || name === '..') {
          part.file.resume()
          continue
        }
        const target = path.join(directory, name)
        await new Promise<void>((resolve, reject) => {
          const output = sftp.createWriteStream(target, { mode: 0o640 })
          part.file.once('error', reject)
          output.once('error', reject)
          output.once('close', resolve)
          part.file.pipe(output)
        })
        uploaded += 1
      }
      return reply.code(201).send({ uploaded })
    } finally {
      connection.close()
    }
  })
}

function basenameForHeader(target: string): string {
  return path.basename(target).replace(/["\\\r\n]/g, '_')
}

export async function terminalSocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/terminal', { websocket: true }, (socket, request) => {
    if (
      config.NODE_ENV === 'production' &&
      request.headers.origin !== config.APP_ORIGIN &&
      request.headers.origin !== config.ADMIN_ORIGIN
    ) {
      socket.close(1008, 'Origin denied')
      return
    }
    let connection: SshConnection | null = null
    let shell: ClientChannel | null = null
    let pendingInput = ''
    let pendingWindow: { cols: number; rows: number } | null = null
    const close = (): void => {
      try {
        shell?.end()
      } catch {
        // already closed
      }
      connection?.close()
      connection = null
    }
    socket.once('close', close)
    socket.once('error', close)
    socket.on('message', (rawMessage: Buffer) => {
      try {
        const message = JSON.parse(rawMessage.toString()) as {
          type: 'input' | 'resize'
          data?: string
          cols?: number
          rows?: number
        }
        if (message.type === 'input' && typeof message.data === 'string') {
          const input = message.data.slice(0, 16_384)
          if (shell) shell.write(input)
          else pendingInput = `${pendingInput}${input}`.slice(0, 16_384)
        }
        if (message.type === 'resize') {
          const cols = Math.max(20, Math.min(500, Number(message.cols) || 120))
          const rows = Math.max(5, Math.min(200, Number(message.rows) || 32))
          if (shell) shell.setWindow(rows, cols, 0, 0)
          else pendingWindow = { cols, rows }
        }
      } catch {
        socket.close(1003, 'Invalid message')
      }
    })

    void (async () => {
      const query = z.object({ ticket: z.string().uuid() }).safeParse(request.query)
      if (!query.success) {
        socket.close(1008, 'Invalid ticket')
        return
      }
      const raw = await redis.call('GETDEL', `access-ticket:${query.data.ticket}`) as string | null
      if (!raw) {
        socket.close(1008, 'Expired ticket')
        return
      }
      const ticket = JSON.parse(raw) as { workspaceId: string; serverId: string; capability: string }
      if (ticket.capability !== 'terminal') {
        socket.close(1008, 'Invalid capability')
        return
      }
      const server = await loadServer(ticket.serverId, ticket.workspaceId)
      if (!server || !server.entitlements.webTerminal) {
        socket.close(1008, 'Access denied')
        return
      }
      const secret = await decryptVaultSecret(...requiredSshSecret(server))
      connection = await SshConnection.connect(secret)
      connection.client.shell(
        { term: 'xterm-256color', cols: 120, rows: 32 },
        (error, channel) => {
          if (error) {
            socket.close(1011, 'Shell unavailable')
            close()
            return
          }
          shell = channel
          if (pendingWindow) channel.setWindow(pendingWindow.rows, pendingWindow.cols, 0, 0)
          if (pendingInput) channel.write(pendingInput)
          pendingWindow = null
          pendingInput = ''
          channel.on('data', (chunk: Buffer) => {
            if (socket.readyState === 1) {
              socket.send(JSON.stringify({ type: 'output', data: chunk.toString('utf8') }))
            }
          })
          channel.stderr.on('data', (chunk: Buffer) => {
            if (socket.readyState === 1) {
              socket.send(JSON.stringify({ type: 'output', data: chunk.toString('utf8') }))
            }
          })
          channel.once('close', () => socket.close(1000, 'Shell closed'))
        }
      )
    })().catch((error) => {
      request.log.warn({ error: (error as Error).message }, 'terminal websocket failed')
      socket.close(1011, 'Connection failed')
      close()
    })
  })
}
