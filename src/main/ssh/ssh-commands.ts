export const COMMANDS = {
  system: {
    cpu: `top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || top -bn1 | grep '%Cpu' | awk '{print $2}' 2>/dev/null`,
    memory: `free -b | awk '/Mem:/{printf "%d %d %d", $2, $3, $7}'`,
    disk: `df -B1 --output=source,size,used,avail,pcent,target 2>/dev/null | tail -n+2 || df -k | tail -n+2`,
    network: `cat /proc/net/dev | tail -n+3`,
    uptime: `uptime -s 2>/dev/null || date -r $(sysctl -n kern.boottime | awk '{print $4}' | tr -d ',') '+%Y-%m-%d %H:%M:%S' 2>/dev/null`,
    loadAvg: `cat /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null`,
    osInfo: `cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null`
  },
  docker: {
    check: `command -v docker && docker info --format '{{.ServerVersion}}' 2>/dev/null`,
    containers: `docker ps -a --format '{{json .}}'`,
    images: `docker images --format '{{json .}}'`,
    stats: `docker stats --no-stream --format '{{json .}}'`,
    logs: (id: string, tail: number): string => `docker logs --tail ${tail} -f ${id} 2>&1`,
    inspect: (id: string): string => `docker inspect ${id}`,
    networks: `docker network ls --format '{{json .}}'`,
    volumes: `docker volume ls --format '{{json .}}'`,
    start: (id: string): string => `docker start ${id}`,
    stop: (id: string): string => `docker stop ${id}`,
    restart: (id: string): string => `docker restart ${id}`,
    remove: (id: string): string => `docker rm -f ${id}`
  },
  kubernetes: {
    check: `command -v kubectl >/dev/null 2>&1 && echo "kubectl" || { command -v k3s >/dev/null 2>&1 && echo "k3s" || exit 1; }`,
    nodes: `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); $_K get nodes -o json 2>/dev/null`,
    pods: `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); $_K get pods --all-namespaces -o json 2>/dev/null`,
    services: `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); $_K get services --all-namespaces -o json 2>/dev/null`,
    deployments: `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); $_K get deployments --all-namespaces -o json 2>/dev/null`,
    events: `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); $_K get events --all-namespaces --sort-by='.lastTimestamp' -o json 2>/dev/null`,
    logs: (ns: string, pod: string, container?: string): string =>
      `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); $_K logs -n ${ns} ${pod}${container ? ` -c ${container}` : ''} --tail=500 -f 2>&1`,
    podDescribe: (ns: string, pod: string): string =>
      `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); $_K describe pod -n ${ns} ${pod} 2>/dev/null`,
    top: `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl"); ($_K top nodes --no-headers 2>/dev/null; echo '---'; $_K top pods --all-namespaces --no-headers 2>/dev/null) || echo 'metrics-server not available'`
  }
}
