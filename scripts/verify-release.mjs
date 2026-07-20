import { readFileSync } from 'node:fs'
import process from 'node:process'

function fail(message) {
  console.error(`Release validation failed: ${message}`)
  process.exitCode = 1
}

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const tag = process.argv[2]
const expectedTag = `v${packageJson.version}`

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  fail(`package.json version is not valid semver: ${packageJson.version}`)
}
if (tag && tag !== expectedTag) {
  fail(`tag ${tag} does not match package version ${expectedTag}`)
}
if (packageLock.version !== packageJson.version || packageLock.packages?.['']?.version !== packageJson.version) {
  fail('package-lock.json version does not match package.json')
}

const macTargets = (packageJson.build?.mac?.target ?? []).map((entry) => typeof entry === 'string' ? entry : entry.target)
if (!macTargets.includes('dmg') || !macTargets.includes('zip')) {
  fail('macOS targets must include both dmg and zip (electron-updater requires zip)')
}
if (packageJson.build?.mac?.notarize !== true) {
  fail('macOS notarization must be enabled for production releases')
}
if (packageJson.build?.publish?.[0]?.provider !== 'github') {
  fail('GitHub publish provider is missing')
}

if (!process.exitCode) {
  console.log(tag ? `Release configuration is valid for ${expectedTag}` : `Release configuration is valid (next tag: ${expectedTag})`)
}
