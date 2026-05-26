export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('tr-TR')
}

export function formatUptime(uptimeStr: string): string {
  if (!uptimeStr) return 'Bilinmiyor'
  try {
    const start = new Date(uptimeStr).getTime()
    const diff = Date.now() - start
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    if (days > 0) return `${days}g ${hours}s ${minutes}d`
    if (hours > 0) return `${hours}s ${minutes}d`
    return `${minutes}d`
  } catch {
    return uptimeStr
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}sn`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}dk`
  return `${Math.floor(seconds / 3600)}s`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function getMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    cpu_percent: 'CPU %',
    memory_percent: 'RAM %',
    disk_percent: 'Disk %',
    network_rx_bytes: 'Ağ Giriş',
    network_tx_bytes: 'Ağ Çıkış',
    k8s_pod_restarts: 'Pod Yeniden Başlatma',
    k8s_pod_crash_loop: 'Pod CrashLoop',
    k8s_pod_oom_killed: 'Pod OOMKilled',
    k8s_pod_image_pull_error: 'Pod Image Hatası',
    k8s_node_not_ready: 'Node Hazır Değil',
    k8s_deployment_unavailable: 'Deployment Kullanılamaz',
    docker_container_exited: 'Container Durdu',
    docker_container_restarting: 'Container Yeniden Başlıyor',
    connection_lost: 'Sunucu Erişilemez (SSH)'
  }
  return labels[metric] || metric
}
