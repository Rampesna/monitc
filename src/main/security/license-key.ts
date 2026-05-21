import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const LICENSE_FILE = 'monitc-license.key'
const CONFIRMED_FILE = 'monitc-license.confirmed'

function getLicenseFilePath(): string {
  return path.join(app.getPath('userData'), LICENSE_FILE)
}

function getConfirmedFilePath(): string {
  return path.join(app.getPath('userData'), CONFIRMED_FILE)
}

export function generateLicenseKey(): string {
  const raw = crypto.randomBytes(18).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24)
  const padded = raw.padEnd(24, 'A')
  return [padded.slice(0, 4), padded.slice(4, 8), padded.slice(8, 12), padded.slice(12, 16), padded.slice(16, 20), padded.slice(20, 24)].join('-')
}

export function saveLicenseKey(key: string): void {
  fs.writeFileSync(getLicenseFilePath(), key, 'utf8')
}

export function markLicenseConfirmed(): void {
  fs.writeFileSync(getConfirmedFilePath(), '1', 'utf8')
}

export function isLicenseConfirmed(): boolean {
  return fs.existsSync(getConfirmedFilePath())
}

export function loadLicenseKey(): string | null {
  const filePath = getLicenseFilePath()
  if (!fs.existsSync(filePath)) return null
  const key = fs.readFileSync(filePath, 'utf8').trim()
  if (!isValidLicenseKey(key)) return null
  return key
}

export function isValidLicenseKey(key: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)
}

export function initializeLicense(): { key: string; isNew: boolean } {
  const existing = loadLicenseKey()
  if (existing) {
    const confirmed = isLicenseConfirmed()
    return { key: existing, isNew: !confirmed }
  }
  const key = generateLicenseKey()
  saveLicenseKey(key)
  return { key, isNew: true }
}
