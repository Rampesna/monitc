import os from 'os'
import crypto from 'crypto'

export function getMachineId(): string {
  const cpus = os.cpus()
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown'
  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    cpuModel,
    String(os.totalmem())
  ].join('|')
  return crypto.createHash('sha256').update(raw).digest('hex')
}
