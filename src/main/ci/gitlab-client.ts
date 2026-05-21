async function glFetch<T>(pat: string, baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v4${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'PRIVATE-TOKEN': pat,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitLab API ${res.status}: ${body.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

function encodeId(id: string | number): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

export async function glListProjects(pat: string, baseUrl: string): Promise<unknown[]> {
  return glFetch<unknown[]>(pat, baseUrl, '/projects?membership=true&per_page=100&order_by=updated_at&simple=true')
}

export async function glListPipelines(pat: string, baseUrl: string, projectId: string | number, perPage = 20): Promise<unknown[]> {
  return glFetch<unknown[]>(pat, baseUrl, `/projects/${encodeId(projectId)}/pipelines?per_page=${perPage}`)
}

export async function glTriggerPipeline(pat: string, baseUrl: string, projectId: string | number, ref: string, variables?: Record<string, string>): Promise<unknown> {
  const vars = variables ? Object.entries(variables).map(([key, value]) => ({ key, value })) : []
  return glFetch(pat, baseUrl, `/projects/${encodeId(projectId)}/pipeline`, {
    method: 'POST',
    body: JSON.stringify({ ref, variables: vars })
  })
}

export async function glGetPipeline(pat: string, baseUrl: string, projectId: string | number, pipelineId: number): Promise<unknown> {
  return glFetch(pat, baseUrl, `/projects/${encodeId(projectId)}/pipelines/${pipelineId}`)
}

export async function glGetPipelineJobs(pat: string, baseUrl: string, projectId: string | number, pipelineId: number): Promise<unknown[]> {
  return glFetch<unknown[]>(pat, baseUrl, `/projects/${encodeId(projectId)}/pipelines/${pipelineId}/jobs`)
}

export async function glSetVariable(pat: string, baseUrl: string, projectId: string | number, key: string, value: string, masked = true, isProtected = false): Promise<unknown> {
  try {
    return await glFetch(pat, baseUrl, `/projects/${encodeId(projectId)}/variables/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, masked, protected: isProtected })
    })
  } catch {
    return glFetch(pat, baseUrl, `/projects/${encodeId(projectId)}/variables`, {
      method: 'POST',
      body: JSON.stringify({ key, value, masked, protected: isProtected })
    })
  }
}

export async function glListBranches(pat: string, baseUrl: string, projectId: string | number): Promise<unknown[]> {
  return glFetch<unknown[]>(pat, baseUrl, `/projects/${encodeId(projectId)}/repository/branches?per_page=100`)
}

export async function glTestConnection(pat: string, baseUrl: string): Promise<{ success: boolean; username?: string; error?: string }> {
  try {
    const user = await glFetch<{ username: string }>(pat, baseUrl, '/user')
    return { success: true, username: user.username }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
