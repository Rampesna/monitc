import compression from 'compression'
import crypto from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import express from 'express'
import helmet from 'helmet'
import multer from 'multer'
import YAML from 'yaml'

const port = Number(process.env.PORT || 9119)
const dataDirectory = resolve(process.env.DATA_DIR || '/data')
const updatesDirectory = join(dataDirectory, 'updates')
const temporaryDirectory = join(dataDirectory, 'tmp')
const releaseFile = join(dataDirectory, 'release.json')
const distDirectory = resolve('dist')
const assetsDirectory = join(distDirectory, 'assets')
const adminToken = process.env.UPDATE_ADMIN_TOKEN || ''
const publicOrigin = (process.env.PUBLIC_ORIGIN || 'https://monitc.talhacan.com').replace(/\/$/, '')
const allowedNames = /^(latest(?:-mac|-linux)?\.ya?ml|[a-zA-Z0-9][a-zA-Z0-9._+() -]*\.(?:dmg|zip|exe|AppImage|deb|blockmap))$/

for (const directory of [dataDirectory, updatesDirectory, temporaryDirectory]) mkdirSync(directory, { recursive: true })

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))
app.use(compression())
app.use(express.json({ limit: '256kb' }))

function safeEqual(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function requireAdmin(request, response, next) {
  const provided = request.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!adminToken || !provided || !safeEqual(provided, adminToken)) return response.status(401).json({ error: 'Invalid admin key.' })
  next()
}

function listFiles() {
  return readdirSync(updatesDirectory)
    .filter((name) => statSync(join(updatesDirectory, name)).isFile())
    .map((name) => ({ name, size: statSync(join(updatesDirectory, name)).size, url: `${publicOrigin}/updates/${encodeURIComponent(name)}` }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function readRelease() {
  if (!existsSync(releaseFile)) return { version: '1.4.1', summary: 'Desktop, self-hosted and managed cloud operations in one calm workspace.', publishedAt: null, downloads: [] }
  return JSON.parse(readFileSync(releaseFile, 'utf8'))
}

function fileSha512(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = crypto.createHash('sha512')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash(hash.digest('base64')))
  })
}

app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'monitc-release-feed' }))
app.get('/api/releases/latest', (_request, response) => {
  const release = readRelease()
  const preferred = release.downloads?.find((file) => file.name.endsWith('.dmg')) || release.downloads?.find((file) => /\.(exe|AppImage|zip)$/.test(file.name))
  response.json({ ...release, downloadUrl: preferred?.url || '' })
})
app.get('/api/admin/files', requireAdmin, (_request, response) => response.json({ files: listFiles() }))

const upload = multer({
  dest: temporaryDirectory,
  limits: { files: 30, fileSize: 1_200_000_000 },
  fileFilter: (_request, file, callback) => callback(null, allowedNames.test(basename(file.originalname)))
})

app.post('/api/admin/releases', requireAdmin, upload.array('files', 30), async (request, response) => {
  const uploaded = request.files || []
  const cleanTemporaryFiles = () => uploaded.forEach((file) => { if (existsSync(file.path)) rmSync(file.path) })

  try {
    const version = String(request.body.version || '').trim().replace(/^v/, '')
    const notes = String(request.body.notes || '').trim().slice(0, 20_000)
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Version must use semantic versioning, for example 1.3.0.')
    if (uploaded.length === 0) throw new Error('No valid release files were received.')

    const incomingFiles = new Map(uploaded.map((file) => [basename(file.originalname), file.path]))
    const incomingNames = new Set(incomingFiles.keys())
    const availableNames = new Set([...listFiles().map((file) => file.name), ...incomingNames])
    const manifests = uploaded.filter((file) => /^latest.*\.ya?ml$/.test(file.originalname))
    if (manifests.length === 0) throw new Error('At least one updater manifest (latest*.yml) is required.')

    for (const manifest of manifests) {
      const content = readFileSync(manifest.path, 'utf8')
      const metadata = YAML.parse(content)
      const declaredVersion = String(metadata?.version || '')
      if (declaredVersion && declaredVersion !== version) throw new Error(`${manifest.originalname} declares version ${declaredVersion}, not ${version}.`)
      const entries = Array.isArray(metadata?.files) ? metadata.files : []
      if (entries.length === 0) throw new Error(`${manifest.originalname} does not contain any package entries.`)

      for (const entry of entries) {
        const name = basename(String(entry?.url || ''))
        if (!name || !availableNames.has(name)) throw new Error(`${manifest.originalname} references missing file ${name || '(empty)'}.`)
        const filePath = incomingFiles.get(name) || join(updatesDirectory, name)
        const actualSize = statSync(filePath).size
        if (Number(entry.size) !== actualSize) throw new Error(`${name} size does not match ${manifest.originalname}.`)
        if (!entry.sha512) throw new Error(`${manifest.originalname} is missing the SHA-512 value for ${name}.`)
        const actualHash = await fileSha512(filePath)
        if (!safeEqual(actualHash, String(entry.sha512))) throw new Error(`${name} SHA-512 does not match ${manifest.originalname}.`)
      }
    }

    for (const file of uploaded) renameSync(file.path, join(updatesDirectory, basename(file.originalname)))
    const downloads = uploaded
      .map((file) => basename(file.originalname))
      .filter((name) => /\.(dmg|zip|exe|AppImage|deb)$/.test(name))
      .map((name) => ({ name, url: `${publicOrigin}/updates/${encodeURIComponent(name)}` }))
    const release = {
      version,
      summary: notes.split('\n').find(Boolean)?.slice(0, 140) || `monitc ${version} is now available`,
      notes,
      publishedAt: new Date().toISOString(),
      downloads
    }
    writeFileSync(releaseFile, `${JSON.stringify(release, null, 2)}\n`, { mode: 0o600 })
    response.status(201).json({ ok: true, release })
  } catch (error) {
    cleanTemporaryFiles()
    response.status(400).json({ error: error.message })
  }
})

app.use('/updates', express.static(updatesDirectory, { fallthrough: false, immutable: false, maxAge: 0, etag: true }))
app.use('/assets', express.static(assetsDirectory, { fallthrough: true, immutable: true, maxAge: '1y', etag: true }))
app.get(/^\/assets\/index-[0-9A-Za-z_-]+\.(?:js|css)$/, (request, response, next) => {
  const extension = extname(request.path)
  const currentAsset = readdirSync(assetsDirectory).find((name) => name.startsWith('index-') && extname(name) === extension)
  if (!currentAsset) return next()
  response.set('Cache-Control', 'no-cache, max-age=0, must-revalidate')
  response.sendFile(join(assetsDirectory, currentAsset))
})
app.use(express.static(distDirectory, { index: false, maxAge: '1h', etag: true }))
app.use((request, response, next) => {
  if (request.method !== 'GET' || request.path.startsWith('/api/') || request.path.startsWith('/updates/')) return next()
  response.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate')
  response.sendFile(join(distDirectory, 'index.html'))
})

app.use((error, _request, response, _next) => {
  console.error(error)
  if (error instanceof multer.MulterError) return response.status(400).json({ error: error.message })
  response.status(error.status || 500).json({ error: error.status === 404 ? 'File not found.' : 'Unexpected server error.' })
})

app.listen(port, '0.0.0.0', () => console.log(`monitc website listening on ${port}`))
