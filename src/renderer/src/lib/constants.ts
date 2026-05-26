export const METRIC_TYPES = [
  { value: 'cpu_percent', label: 'CPU %' },
  { value: 'memory_percent', label: 'RAM %' },
  { value: 'disk_percent', label: 'Disk %' },
  { value: 'network_rx_bytes', label: 'Ağ Giriş (bytes/s)' },
  { value: 'network_tx_bytes', label: 'Ağ Çıkış (bytes/s)' },
  { value: 'k8s_pod_restarts', label: 'K8s Pod Yeniden Başlatma' },
  { value: 'k8s_pod_crash_loop', label: 'K8s Pod CrashLoopBackOff' },
  { value: 'k8s_pod_oom_killed', label: 'K8s Pod OOMKilled' },
  { value: 'k8s_pod_image_pull_error', label: 'K8s Pod ImagePullBackOff' },
  { value: 'k8s_node_not_ready', label: 'K8s Node NotReady' },
  { value: 'k8s_deployment_unavailable', label: 'K8s Deployment Kullanılamaz' },
  { value: 'docker_container_exited', label: 'Docker Container Durdu' },
  { value: 'docker_container_restarting', label: 'Docker Container Yeniden Başlıyor' },
  { value: 'connection_lost', label: 'Sunucu Erişilemez (SSH)' }
]

export const EVENT_METRICS = ['connection_lost'] as const

export function isEventMetric(metric: string): boolean {
  return (EVENT_METRICS as readonly string[]).includes(metric)
}

export const OPERATOR_LABELS = {
  gt: 'büyüktür (>)',
  lt: 'küçüktür (<)',
  eq: 'eşittir (=)'
}

export const ALERT_TEMPLATES = [
  {
    id: 'cpu-critical',
    name: 'CPU Kritik',
    metric: 'cpu_percent',
    operator: 'gt',
    threshold: 90,
    durationSeconds: 30,
    cooldownMinutes: 15
  },
  {
    id: 'cpu-warning',
    name: 'CPU Uyarı',
    metric: 'cpu_percent',
    operator: 'gt',
    threshold: 80,
    durationSeconds: 60,
    cooldownMinutes: 30
  },
  {
    id: 'ram-warning',
    name: 'RAM Uyarı',
    metric: 'memory_percent',
    operator: 'gt',
    threshold: 80,
    durationSeconds: 30,
    cooldownMinutes: 30
  },
  {
    id: 'disk-full',
    name: 'Disk Dolu',
    metric: 'disk_percent',
    operator: 'gt',
    threshold: 90,
    durationSeconds: 10,
    cooldownMinutes: 60
  },
  {
    id: 'pod-crash',
    name: 'Pod CrashLoop',
    metric: 'k8s_pod_crash_loop',
    operator: 'gt',
    threshold: 0,
    durationSeconds: 10,
    cooldownMinutes: 15
  },
  {
    id: 'container-down',
    name: 'Container Durdu',
    metric: 'docker_container_exited',
    operator: 'gt',
    threshold: 0,
    durationSeconds: 10,
    cooldownMinutes: 15
  },
  {
    id: 'server-unreachable',
    name: 'Sunucu Erişilemez',
    metric: 'connection_lost',
    operator: 'gt',
    threshold: 0,
    durationSeconds: 30,
    cooldownMinutes: 15
  }
]
