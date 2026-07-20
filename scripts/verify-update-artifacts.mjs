import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

let invalid = false
for (const manifest of manifests) {
  const file = files.find((candidate) => basename(candidate) === manifest.name)
  if (!file) {
    console.error(`Missing updater manifest: ${manifest.name}`)
    invalid = true
    continue
  }

  const content = readFileSync(file, 'utf8')
  const urls = [...content.matchAll(/^\s*-?\s*url:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((match) => basename(match[1]))
  const installer = urls.find((name) => name.endsWith(manifest.extension))
  if (!installer) {
    console.error(`${manifest.name} does not reference a ${manifest.extension} package`)
    invalid = true
  } else if (!names.has(installer)) {
    console.error(`${manifest.name} references missing package: ${installer}`)
    invalid = true
  }
}

if (invalid) process.exit(1)
console.log(`Verified updater manifests and packages in ${root}`)
