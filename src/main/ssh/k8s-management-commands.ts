export const KUBECTL_PREFIX = `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml 2>/dev/null; KUBECONFIG=${`\${KUBECONFIG:-$HOME/.kube/config}`}; _K=$(command -v kubectl 2>/dev/null || echo "k3s kubectl")`

export function k8sCmd(cmd: string): string {
  return `${KUBECTL_PREFIX}; $_K ${cmd}`
}

function k(cmd: string): string {
  return k8sCmd(cmd)
}

export const K8S_MGMT = {
  listNamespaces: k('get namespaces -o json'),

  createNamespace: (name: string): string =>
    k(`create namespace ${name} --dry-run=client -o yaml | $_K apply -f -`),

  deleteNamespace: (name: string): string =>
    k(`delete namespace ${name}`),

  listSecrets: (ns: string): string =>
    k(`get secrets -n ${ns} -o json`),

  createSecretGeneric: (name: string, ns: string, literals: Record<string, string>): string => {
    const literalArgs = Object.entries(literals).map(([k, v]) => `--from-literal=${k}='${v.replace(/'/g, "'\\''")}'`).join(' ')
    return k(`create secret generic ${name} ${literalArgs} -n ${ns} --dry-run=client -o yaml | $_K apply -f -`)
  },

  createSecretDockerRegistry: (name: string, ns: string, server: string, user: string, pass: string, email: string): string =>
    k(`create secret docker-registry ${name} --docker-server='${server}' --docker-username='${user}' --docker-password='${pass.replace(/'/g, "'\\''")}' --docker-email='${email}' -n ${ns} --dry-run=client -o yaml | $_K apply -f -`),

  createSecretTls: (name: string, ns: string, certPath: string, keyPath: string): string =>
    k(`create secret tls ${name} --cert='${certPath}' --key='${keyPath}' -n ${ns} --dry-run=client -o yaml | $_K apply -f -`),

  deleteSecret: (name: string, ns: string): string =>
    k(`delete secret ${name} -n ${ns}`),

  listServiceAccounts: (ns: string): string =>
    k(`get serviceaccounts -n ${ns} -o json`),

  createServiceAccount: (name: string, ns: string): string =>
    k(`create serviceaccount ${name} -n ${ns} --dry-run=client -o yaml | $_K apply -f -`),

  createClusterRoleBinding: (bindingName: string, saName: string, ns: string, clusterRole = 'cluster-admin'): string =>
    k(`create clusterrolebinding ${bindingName} --clusterrole=${clusterRole} --serviceaccount=${ns}:${saName} --dry-run=client -o yaml | $_K apply -f -`),

  createSATokenSecret: (saName: string, ns: string): string =>
    k(`apply -f - <<'YAMLEOF'\napiVersion: v1\nkind: Secret\nmetadata:\n  name: ${saName}-token\n  namespace: ${ns}\n  annotations:\n    kubernetes.io/service-account.name: ${saName}\ntype: kubernetes.io/service-account-token\nYAMLEOF`),

  getSAToken: (saName: string, ns: string): string =>
    k(`get secret ${saName}-token -n ${ns} -o jsonpath='{.data.token}' 2>/dev/null | base64 -d; echo`),

  getKubeconfig: (): string =>
    `(sudo cat /etc/rancher/k3s/k3s.yaml 2>/dev/null) || (cat $HOME/.kube/config 2>/dev/null) || (sudo cat /etc/kubernetes/admin.conf 2>/dev/null)`,

  generateCICDKubeconfig: (serverIp: string): string =>
    `_RAW=$(sudo cat /etc/rancher/k3s/k3s.yaml 2>/dev/null || cat $HOME/.kube/config 2>/dev/null || sudo cat /etc/kubernetes/admin.conf 2>/dev/null); echo "$_RAW" | sed 's|https://127.0.0.1:|https://${serverIp}:|g' | sed 's|https://localhost:|https://${serverIp}:|g' | base64 | tr -d '\\n'; echo`,

  applyYaml: (yamlContent: string, ns?: string): string => {
    const nsFlag = ns ? ` -n ${ns}` : ''
    const escaped = yamlContent.replace(/'/g, "'\\''")
    return k(`apply -f - ${nsFlag} <<'MONITCEOF'\n${escaped}\nMONITCEOF`)
  },

  deleteResource: (type: string, name: string, ns: string): string =>
    k(`delete ${type} ${name} -n ${ns}`),

  listDeployments: (ns?: string): string =>
    ns ? k(`get deployments -n ${ns} -o json`) : k('get deployments --all-namespaces -o json'),

  listConfigMaps: (ns: string): string =>
    k(`get configmaps -n ${ns} -o json`),

  getClusterInfo: (): string =>
    k('cluster-info 2>/dev/null; echo "---"; $_K get nodes -o wide 2>/dev/null')
}
