const CPU_FACTORS: Record<string, number> = {
  n: 1 / 1_000_000,
  u: 1 / 1_000,
  m: 1,
  '': 1_000
}

const MEMORY_FACTORS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  K: 1000,
  M: 1000 ** 2,
  G: 1000 ** 3,
  '': 1
}

export function parseCpuMillicores(value: string | undefined): number {
  if (!value) return 0
  const match = value.trim().match(/^([0-9.]+)(n|u|m)?$/)
  if (!match) return 0
  return Number(match[1]) * (CPU_FACTORS[match[2] || ''] || 0)
}

export function parseMemoryBytes(value: string | undefined): number {
  if (!value) return 0
  const match = value.trim().match(/^([0-9.]+)(Ki|Mi|Gi|Ti|K|M|G)?$/)
  if (!match) return 0
  return Number(match[1]) * (MEMORY_FACTORS[match[2] || ''] || 0)
}

export function percent(used: number, assigned: number): number | null {
  if (assigned <= 0) return null
  return Math.round((used / assigned) * 10_000) / 100
}
