const KUBECTL_PREFIX = `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml 2>/dev/null; KUBECONFIG=${`\${KUBECONFIG:-$HOME/.kube/config}`}; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl")`

function k(cmd: string): string {
  return `${KUBECTL_PREFIX}; $_K ${cmd}`
}

export const ROLLOUT_CMDS = {
  restart: (deployment: string, ns: string): string =>
    k(`rollout restart deployment/${deployment} -n ${ns}`),

  status: (deployment: string, ns: string): string =>
    k(`rollout status deployment/${deployment} -n ${ns} --timeout=10s 2>&1 || true`),

  undo: (deployment: string, ns: string, revision?: number): string =>
    revision
      ? k(`rollout undo deployment/${deployment} -n ${ns} --to-revision=${revision}`)
      : k(`rollout undo deployment/${deployment} -n ${ns}`),

  history: (deployment: string, ns: string): string =>
    k(`rollout history deployment/${deployment} -n ${ns}`),

  scale: (deployment: string, ns: string, replicas: number): string =>
    k(`scale deployment/${deployment} -n ${ns} --replicas=${replicas}`),

  setImage: (deployment: string, ns: string, container: string, image: string, tag: string): string =>
    k(`set image deployment/${deployment} ${container}=${image}:${tag} -n ${ns}`),

  patchImage: (deployment: string, ns: string, image: string): string =>
    k(`patch deployment ${deployment} -n ${ns} --type='json' -p='[{"op":"replace","path":"/spec/template/spec/containers/0/image","value":"${image}"}]'`),

  getCurrentImage: (deployment: string, ns: string): string =>
    k(`get deployment ${deployment} -n ${ns} -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{" "}{.image}{"\\n"}{end}'`),

  getReplicaStatus: (deployment: string, ns: string): string =>
    k(`get deployment ${deployment} -n ${ns} -o jsonpath='{.status.readyReplicas}/{.spec.replicas}'`)
}
