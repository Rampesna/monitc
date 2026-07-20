import path from 'path'
import type { Stats, SFTPWrapper } from 'ssh2'
import { sshManager } from './ssh-manager'

const posix = path.posix
const MAX_EDITABLE_FILE_SIZE = 5 * 1024 * 1024

export interface SftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifiedAt: number
  permissions: string
  mode: number
  uid: number
  gid: number
}

function normalize(remotePath: string): string {
  if (!remotePath || remotePath.includes('\0')) throw new Error('Invalid remote path')
  const normalized = posix.normalize(remotePath.startsWith('/') ? remotePath : `/${remotePath}`)
  return normalized || '/'
}

function call<T>(run: (callback: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    run((error, value) => error ? reject(error) : resolve(value))
  })
}

function done(run: (callback: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    run((error) => error ? reject(error) : resolve())
  })
}

function permissionString(mode: number, type: SftpEntry['type']): string {
  const prefix = type === 'directory' ? 'd' : type === 'symlink' ? 'l' : '-'
  const masks = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
  const chars = ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x']
  return prefix + masks.map((mask, index) => mode & mask ? chars[index] : '-').join('')
}

function entryType(attrs: Stats): SftpEntry['type'] {
  if (attrs.isDirectory()) return 'directory'
  if (attrs.isSymbolicLink()) return 'symlink'
  return 'file'
}

async function stat(sftp: SFTPWrapper, remotePath: string): Promise<Stats> {
  return call<Stats>((callback) => sftp.lstat(remotePath, callback))
}

async function mkdirRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const target = normalize(remotePath)
  if (target === '/') return
  const parent = posix.dirname(target)
  if (parent !== target) await mkdirRecursive(sftp, parent)
  try {
    await done((callback) => sftp.mkdir(target, callback))
  } catch (error) {
    const attrs = await stat(sftp, target).catch(() => null)
    if (!attrs?.isDirectory()) throw error
  }
}

async function removeRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const attrs = await stat(sftp, remotePath)
  if (!attrs.isDirectory()) {
    await done((callback) => sftp.unlink(remotePath, callback))
    return
  }

  const children = await call<Array<{ filename: string }>>((callback) => sftp.readdir(remotePath, callback))
  for (const child of children) {
    await removeRecursive(sftp, posix.join(remotePath, child.filename))
  }
  await done((callback) => sftp.rmdir(remotePath, callback))
}

function copyFile(sftp: SFTPWrapper, source: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = sftp.createReadStream(source)
    const writer = sftp.createWriteStream(destination, { flags: 'wx' })
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reader.destroy()
      writer.destroy()
      reject(error)
    }
    reader.on('error', fail)
    writer.on('error', fail)
    writer.on('close', () => {
      if (settled) return
      settled = true
      resolve()
    })
    reader.pipe(writer)
  })
}

async function copyRecursive(sftp: SFTPWrapper, source: string, destination: string): Promise<void> {
  const attrs = await stat(sftp, source)
  if (!attrs.isDirectory()) {
    await copyFile(sftp, source, destination)
    await done((callback) => sftp.chmod(destination, attrs.mode & 0o777, callback))
    return
  }

  await done((callback) => sftp.mkdir(destination, { mode: attrs.mode & 0o777 }, callback))
  const children = await call<Array<{ filename: string }>>((callback) => sftp.readdir(source, callback))
  for (const child of children) {
    await copyRecursive(sftp, posix.join(source, child.filename), posix.join(destination, child.filename))
  }
}

export class SftpManager {
  list(serverId: string, remotePath: string): Promise<SftpEntry[]> {
    const target = normalize(remotePath)
    return sshManager.withSftp(serverId, async (sftp) => {
      const items = await call<Array<{ filename: string; attrs: Stats }>>((callback) => sftp.readdir(target, callback))
      return items
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map(({ filename, attrs }) => {
          const type = entryType(attrs)
          return {
            name: filename,
            path: posix.join(target, filename),
            type,
            size: attrs.size,
            modifiedAt: attrs.mtime * 1000,
            permissions: permissionString(attrs.mode, type),
            mode: attrs.mode & 0o777,
            uid: attrs.uid,
            gid: attrs.gid
          }
        })
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    })
  }

  readFile(serverId: string, remotePath: string): Promise<{ content: string; size: number }> {
    const target = normalize(remotePath)
    return sshManager.withSftp(serverId, async (sftp) => {
      const attrs = await stat(sftp, target)
      if (!attrs.isFile()) throw new Error('Only regular files can be edited')
      if (attrs.size > MAX_EDITABLE_FILE_SIZE) throw new Error('File is larger than the 5 MB editor limit')
      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        const stream = sftp.createReadStream(target)
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', resolve)
        stream.on('error', reject)
      })
      return { content: Buffer.concat(chunks).toString('utf8'), size: attrs.size }
    })
  }

  writeFile(serverId: string, remotePath: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_FILE_SIZE) throw new Error('File is larger than the 5 MB editor limit')
    const target = normalize(remotePath)
    return sshManager.withSftp(serverId, (sftp) => new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(target, { flags: 'w', encoding: 'utf8', mode: 0o644 })
      stream.on('close', resolve)
      stream.on('error', reject)
      stream.end(content)
    }))
  }

  createDirectory(serverId: string, remotePath: string): Promise<void> {
    return sshManager.withSftp(serverId, (sftp) => mkdirRecursive(sftp, normalize(remotePath)))
  }

  rename(serverId: string, source: string, destination: string): Promise<void> {
    const from = normalize(source)
    const to = normalize(destination)
    return sshManager.withSftp(serverId, (sftp) => done((callback) => sftp.rename(from, to, callback)))
  }

  remove(serverId: string, paths: string[]): Promise<void> {
    const targets = paths.map(normalize)
    if (targets.some((target) => target === '/')) throw new Error('The remote root cannot be deleted')
    return sshManager.withSftp(serverId, async (sftp) => {
      for (const target of targets) await removeRecursive(sftp, target)
    })
  }

  paste(serverId: string, sources: string[], destinationDirectory: string, move: boolean): Promise<void> {
    const targets = sources.map(normalize)
    const destination = normalize(destinationDirectory)
    return sshManager.withSftp(serverId, async (sftp) => {
      for (const source of targets) {
        const target = posix.join(destination, posix.basename(source))
        if (target === source) throw new Error('Source and destination are the same')
        if (move) {
          await done((callback) => sftp.rename(source, target, callback))
        } else {
          await copyRecursive(sftp, source, target)
        }
      }
    })
  }

  chmod(serverId: string, remotePath: string, mode: number): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new Error('Invalid permission mode')
    return sshManager.withSftp(serverId, (sftp) => done((callback) => sftp.chmod(normalize(remotePath), mode, callback)))
  }

  uploadFile(serverId: string, localPath: string, remotePath: string): Promise<void> {
    return sshManager.withSftp(serverId, (sftp) => done((callback) => sftp.fastPut(localPath, normalize(remotePath), callback)))
  }

  downloadFile(serverId: string, remotePath: string, localPath: string): Promise<void> {
    return sshManager.withSftp(serverId, (sftp) => done((callback) => sftp.fastGet(normalize(remotePath), localPath, callback)))
  }
}

export const sftpManager = new SftpManager()
