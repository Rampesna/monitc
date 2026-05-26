import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { AppData } from './types'

const DATA_FILE = 'monitc-data.json'

const DEFAULT_DATA: AppData = {
  servers: [],
  integrations: {
    smtp: null,
    whatsapp: null,
    telegram: null,
    github: null,
    gitlab: null
  },
  alertRules: [],
  preferences: {
    theme: 'dark',
    pollIntervals: {
      system: 5,
      docker: 10,
      kubernetes: 10
    },
    sidebarCollapsed: false,
    language: 'en'
  },
  projectLinks: []
}

function getDataFilePath(): string {
  return path.join(app.getPath('userData'), DATA_FILE)
}

function getTmpFilePath(): string {
  return path.join(app.getPath('userData'), DATA_FILE + '.tmp')
}

export function loadData(): AppData {
  const filePath = getDataFilePath()
  if (!fs.existsSync(filePath)) return structuredClone(DEFAULT_DATA)
  try {
    const json = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(json) as AppData
    return { ...structuredClone(DEFAULT_DATA), ...parsed }
  } catch {
    return structuredClone(DEFAULT_DATA)
  }
}

export function saveData(data: AppData): void {
  const json = JSON.stringify(data, null, 2)
  const tmpPath = getTmpFilePath()
  const filePath = getDataFilePath()
  fs.writeFileSync(tmpPath, json, 'utf8')
  fs.renameSync(tmpPath, filePath)
}

export function resetData(): void {
  saveData(structuredClone(DEFAULT_DATA))
}
