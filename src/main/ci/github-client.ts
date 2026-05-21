interface GHHeaders {
  Authorization: string
  Accept: string
  'X-GitHub-Api-Version': string
}

function headers(pat: string): GHHeaders {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

async function ghFetch<T>(pat: string, baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, { ...options, headers: { ...headers(pat), ...(options?.headers ?? {}) } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function ghListRepos(pat: string, baseUrl: string): Promise<unknown[]> {
  return ghFetch<unknown[]>(pat, baseUrl, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')
}

export async function ghListWorkflows(pat: string, baseUrl: string, owner: string, repo: string): Promise<unknown> {
  return ghFetch(pat, baseUrl, `/repos/${owner}/${repo}/actions/workflows`)
}

export async function ghTriggerWorkflow(pat: string, baseUrl: string, owner: string, repo: string, workflowId: string | number, ref: string, inputs?: Record<string, string>): Promise<void> {
  await ghFetch<void>(pat, baseUrl, `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, inputs: inputs ?? {} })
  })
}

export async function ghListRuns(pat: string, baseUrl: string, owner: string, repo: string, perPage = 30): Promise<unknown> {
  return ghFetch(pat, baseUrl, `/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`)
}

export async function ghGetRun(pat: string, baseUrl: string, owner: string, repo: string, runId: number): Promise<unknown> {
  return ghFetch(pat, baseUrl, `/repos/${owner}/${repo}/actions/runs/${runId}`)
}

export async function ghGetRunJobs(pat: string, baseUrl: string, owner: string, repo: string, runId: number): Promise<unknown> {
  return ghFetch(pat, baseUrl, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
}

export async function ghListBranches(pat: string, baseUrl: string, owner: string, repo: string): Promise<unknown[]> {
  return ghFetch<unknown[]>(pat, baseUrl, `/repos/${owner}/${repo}/branches?per_page=100`)
}

export async function ghSetSecret(pat: string, baseUrl: string, owner: string, repo: string, secretName: string, secretValue: string): Promise<void> {
  const keyRes = await ghFetch<{ key_id: string; key: string }>(pat, baseUrl, `/repos/${owner}/${repo}/actions/public-key`)
  const { sodium } = await import('libsodium-wrappers')
  await sodium.ready
  const keyBytes = sodium.from_base64(keyRes.key, sodium.base64_variants.ORIGINAL)
  const secretBytes = sodium.from_string(secretValue)
  const encryptedBytes = sodium.crypto_box_seal(secretBytes, keyBytes)
  const encryptedValue = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL)
  await ghFetch<void>(pat, baseUrl, `/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyRes.key_id })
  })
}

export async function ghTestConnection(pat: string, baseUrl: string): Promise<{ success: boolean; login?: string; error?: string }> {
  try {
    const user = await ghFetch<{ login: string }>(pat, baseUrl, '/user')
    return { success: true, login: user.login }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
