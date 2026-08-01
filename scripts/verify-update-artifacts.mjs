import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.argv[2] ?? 'release-assets')
const files = []

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const target = join(directory, name)
    if (statSync(target).isDirectory()) walk(target)
    else files.push(target)
  }
}

if (!existsSync(root)) {
  console.error(`Artifact directory does not exist: ${root}`)
  process.exit(1)
}
walk(root)

const names = new Set(files.map((file) => basename(file)))
const manifests = [
  { name: 'latest-mac.yml', extension: '.zip' },
  { name: 'latest.yml', extension: '.exe' },
  { name: 'latest-linux.yml', extension: '.AppImage' }
]

function unquote(value) {
  const trimmed = value.trim()
  const first = trimmed.at(0)
  const last = trimmed.at(-1)
  return first && first === last && (first === '"' || first === "'")
    ? trimmed.slice(1, -1)
    : trimmed
}

function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('base64')))
  })
}

function topLevelValue(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))
  return match ? unquote(match[1]) : null
}

let invalid = false
for (const manifest of manifests) {
  const file = files.find((candidate) => basename(candidate) === manifest.name)
  if (!file) {
    console.error(`Missing updater manifest: ${manifest.name}`)
    invalid = true
    continue
  }

  const content = readFileSync(file, 'utf8')
  const entries = [...content.matchAll(
    /^\s*-\s*url:\s*(.+?)\s*$\r?\n\s+sha512:\s*(.+?)\s*$\r?\n\s+size:\s*(\d+)\s*$/gm
  )].map((match) => ({
    name: basename(unquote(match[1])),
    sha512: unquote(match[2]),
    size: Number(match[3])
  }))
  const installer = entries.find(({ name }) => name.endsWith(manifest.extension))
  if (!installer) {
    console.error(`${manifest.name} does not reference a ${manifest.extension} package`)
    invalid = true
  }

  for (const entry of entries) {
    if (!names.has(entry.name)) {
      console.error(`${manifest.name} references missing package: ${entry.name}`)
      invalid = true
      continue
    }

    const packageFile = files.find((candidate) => basename(candidate) === entry.name)
    if (statSync(packageFile).size !== entry.size) {
      console.error(`${manifest.name} contains the wrong size for ${entry.name}`)
      invalid = true
    }
    if (await digest(packageFile) !== entry.sha512) {
      console.error(`${manifest.name} contains the wrong SHA-512 for ${entry.name}`)
      invalid = true
    }
  }

  const legacyPath = topLevelValue(content, 'path')
  const legacySha512 = topLevelValue(content, 'sha512')
  const legacyEntry = entries.find(({ name }) => name === basename(legacyPath ?? ''))
  if (!legacyPath || !legacySha512 || !legacyEntry) {
    console.error(`${manifest.name} contains an invalid legacy path/SHA-512 mapping`)
    invalid = true
  } else if (legacySha512 !== legacyEntry.sha512) {
    console.error(`${manifest.name} legacy SHA-512 does not match ${legacyEntry.name}`)
    invalid = true
  }
}

if (invalid) process.exit(1)
console.log(`Verified updater manifests and packages in ${root}`)
