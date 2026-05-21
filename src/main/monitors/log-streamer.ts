import { EventEmitter } from 'events'
import { sshManager } from '../ssh/ssh-manager'
import { COMMANDS } from '../ssh/ssh-commands'

interface LogStream {
  serverId: string
  streamId: string
  close: () => void
}

export class LogStreamer extends EventEmitter {
  private streams = new Map<string, LogStream>()

  startDockerLog(serverId: string, containerId: string, tail = 500): string {
    const streamId = `docker:${serverId}:${containerId}`
    this.stopStream(streamId)
    const command = COMMANDS.docker.logs(containerId, tail)
    const close = sshManager.streamCommand(
      serverId,
      command,
      (data) => this.emit('data', { streamId, data }),
      () => this.emit('close', { streamId }),
      (err) => this.emit('error', { streamId, error: err.message })
    )
    this.streams.set(streamId, { serverId, streamId, close })
    return streamId
  }

  startKubernetesLog(serverId: string, namespace: string, pod: string, container?: string): string {
    const streamId = `k8s:${serverId}:${namespace}:${pod}:${container || 'default'}`
    this.stopStream(streamId)
    const command = COMMANDS.kubernetes.logs(namespace, pod, container)
    const close = sshManager.streamCommand(
      serverId,
      command,
      (data) => this.emit('data', { streamId, data }),
      () => this.emit('close', { streamId }),
      (err) => this.emit('error', { streamId, error: err.message })
    )
    this.streams.set(streamId, { serverId, streamId, close })
    return streamId
  }

  stopStream(streamId: string): void {
    const stream = this.streams.get(streamId)
    if (stream) {
      stream.close()
      this.streams.delete(streamId)
    }
  }

  stopAllForServer(serverId: string): void {
    for (const [id, stream] of this.streams.entries()) {
      if (stream.serverId === serverId) {
        stream.close()
        this.streams.delete(id)
      }
    }
  }

  stopAll(): void {
    for (const stream of this.streams.values()) stream.close()
    this.streams.clear()
  }
}

export const logStreamer = new LogStreamer()
