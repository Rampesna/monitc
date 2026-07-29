import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { parse as parseYaml } from 'yaml'
import { requirePlatformAdmin } from '../auth/guard.js'
import { config } from '../config.js'
import { redis } from '../lib/redis.js'

const allowedArtifact = /^(latest(?:-mac|-linux)?\.ya?ml|[a-zA-Z0-9][a-zA-Z0-9._+() -]*\.(?:dmg|zip|exe|AppImage|deb|blockmap))$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const manifestPackages = new Map([
  ['latest-mac.yml', '.zip'],
  ['latest-mac.yaml', '.zip'],
  ['latest.yml', '.exe'],
  ['latest.yaml', '.exe'],
  ['latest-linux.yml', '.AppImage'],
  ['latest-linux.yaml', '.AppImage']
])

interface ReleaseMetadata {
  version: string
  summary: string
  publishedAt: string
  downloadUrl: string
}

interface ManifestFile {
  url?: unknown
  sha512?: unknown
  size?: unknown
}

interface UpdateManifest {
  version?: unknown
  files?: unknown
}

function isManifest(name: string): boolean {
  return manifestPackages.has(name)
}

async function sha512(filePath: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('base64')
}

async function validateManifests(staging: string, uploaded: string[], version: string): Promise<void> {
  const uploadedSet = new Set(uploaded)
  const manifests = uploaded.filter(isManifest)
  if (!manifests.length) throw new Error('An electron-updater latest*.yml manifest is required.')

  for (const manifestName of manifests) {
    const document = parseYaml(await readFile(join(staging, manifestName), 'utf8')) as UpdateManifest
    if (String(document?.version || '') !== version) {
      throw new Error(`${manifestName} must declare version ${version}.`)
    }
    if (!Array.isArray(document.files) || !document.files.length) {
      throw new Error(`${manifestName} does not contain package entries.`)
    }

    const expectedExtension = manifestPackages.get(manifestName)!
    let expectedPackageFound = false
    for (const rawEntry of document.files) {
      const entry = rawEntry as ManifestFile
      const fileName = basename(String(entry?.url || ''))
      if (!fileName || !allowedArtifact.test(fileName) || isManifest(fileName)) {
        throw new Error(`${manifestName} contains an invalid package path.`)
      }
      if (fileName.endsWith(expectedExtension)) expectedPackageFound = true
      const filePath = uploadedSet.has(fileName)
        ? join(staging, fileName)
        : join(config.RELEASES_PATH, fileName)
      const details = await stat(filePath).catch(() => null)
      if (!details?.isFile()) throw new Error(`${manifestName} references missing package ${fileName}.`)
      if (!Number.isSafeInteger(Number(entry.size)) || Number(entry.size) !== details.size) {
        throw new Error(`${fileName} size does not match ${manifestName}.`)
      }
      const declaredHash = String(entry.sha512 || '')
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(declaredHash) || declaredHash !== await sha512(filePath)) {
        throw new Error(`${fileName} SHA-512 does not match ${manifestName}.`)
      }
    }
    if (!expectedPackageFound) {
      throw new Error(`${manifestName} must reference a ${expectedExtension} update package.`)
    }
  }
}

async function releasePublishLock(token: string): Promise<boolean> {
  return await redis.set('release:publish:lock', token, 'PX', 10 * 60_000, 'NX') === 'OK'
}

async function releasePublishUnlock(token: string): Promise<void> {
  await redis.eval(
    `if redis.call("get", KEYS[1]) == ARGV[1] then
       return redis.call("del", KEYS[1])
     end
     return 0`,
    1,
    'release:publish:lock',
    token
  )
}

async function releaseMetadata(): Promise<ReleaseMetadata> {
  const path = join(config.RELEASES_PATH, 'release.json')
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ReleaseMetadata
  } catch {
    return {
      version: '1.4.0',
      summary: 'monitc cloud and self-hosted platform',
      publishedAt: new Date(0).toISOString(),
      downloadUrl: 'https://github.com/Rampesna/monitc/releases/latest'
    }
  }
}

export async function releaseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/latest', async () => releaseMetadata())

  app.get('/files', { preHandler: requirePlatformAdmin }, async () => {
    await mkdir(config.RELEASES_PATH, { recursive: true })
    const files = await readdir(config.RELEASES_PATH)
    const rows = await Promise.all(
      files
        .filter((name) => name !== '.staging')
        .map(async (name) => {
          const details = await stat(join(config.RELEASES_PATH, name))
          return { name, size: details.size, modifiedAt: details.mtime.toISOString() }
        })
    )
    return { files: rows.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) }
  })

  app.post(
    '/',
    {
      preHandler: requirePlatformAdmin,
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } }
    },
    async (request, reply) => {
      const lockToken = randomUUID()
      if (!(await releasePublishLock(lockToken))) {
        return reply.code(409).send({ error: 'release_in_progress', message: 'Another release is being published.' })
      }
      await mkdir(config.RELEASES_PATH, { recursive: true })
      const staging = join(config.RELEASES_PATH, `.staging-${Date.now()}`)
      await mkdir(staging, { recursive: true })
      let version = ''
      let notes = ''
      const uploaded: string[] = []

      try {
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if (part.fieldname === 'version') version = String(part.value)
            if (part.fieldname === 'notes') notes = String(part.value).slice(0, 2000)
            continue
          }
          const fileName = basename(part.filename)
          if (!allowedArtifact.test(fileName)) {
            part.file.resume()
            throw new Error(`Unsupported release artifact: ${fileName}`)
          }
          const target = join(staging, fileName)
          await pipeline(part.file, createWriteStream(target, { flags: 'wx', mode: 0o644 }))
          uploaded.push(fileName)
        }
        if (!versionPattern.test(version)) throw new Error('A semantic version is required.')
        await validateManifests(staging, uploaded, version)

        // Packages move first and manifests last, so clients can never observe a
        // new manifest before every referenced byte is available.
        for (const fileName of uploaded.filter((name) => !isManifest(name))) {
          await rename(join(staging, fileName), join(config.RELEASES_PATH, fileName))
        }
        for (const fileName of uploaded.filter(isManifest)) {
          await rename(join(staging, fileName), join(config.RELEASES_PATH, fileName))
        }
        const downloadFile =
          uploaded.find((name) => name.toLowerCase().endsWith('.dmg')) ||
          uploaded.find((name) => name.toLowerCase().endsWith('.exe')) ||
          uploaded.find((name) => name.endsWith('.AppImage')) ||
          uploaded.find((name) => name.toLowerCase().endsWith('.zip')) ||
          uploaded.find((name) => name.toLowerCase().endsWith('.deb')) ||
          ''
        const metadata: ReleaseMetadata = {
          version,
          summary: notes || 'A focused monitc release.',
          publishedAt: new Date().toISOString(),
          downloadUrl: downloadFile
            ? `${config.APP_ORIGIN}/updates/${encodeURIComponent(downloadFile)}`
            : 'https://github.com/Rampesna/monitc/releases/latest'
        }
        const metadataTemp = join(config.RELEASES_PATH, 'release.json.tmp')
        await writeFile(metadataTemp, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 })
        await rename(metadataTemp, join(config.RELEASES_PATH, 'release.json'))
        await access(join(config.RELEASES_PATH, 'release.json'))
        return reply.code(201).send({ release: metadata, files: uploaded })
      } catch (error) {
        return reply.code(400).send({ error: 'release_rejected', message: (error as Error).message })
      } finally {
        await rm(staging, { recursive: true, force: true })
        await releasePublishUnlock(lockToken).catch(() => undefined)
      }
    }
  )
}
