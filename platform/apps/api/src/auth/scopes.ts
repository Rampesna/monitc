import type { GlobalRole, WorkspaceRole } from '@monitc/shared'

const roleScopes: Record<WorkspaceRole, string[]> = {
  viewer: ['workspace:read', 'servers:read', 'metrics:read'],
  operator: ['workspace:read', 'servers:read', 'servers:operate', 'metrics:read', 'terminal:use', 'sftp:use', 'alerts:manage'],
  admin: [
    'workspace:read',
    'workspace:manage',
    'servers:read',
    'servers:write',
    'servers:operate',
    'metrics:read',
    'terminal:use',
    'sftp:use',
    'alerts:manage',
    'members:manage'
  ],
  owner: [
    'workspace:read',
    'workspace:manage',
    'servers:read',
    'servers:write',
    'servers:operate',
    'metrics:read',
    'terminal:use',
    'sftp:use',
    'alerts:manage',
    'members:manage',
    'billing:manage'
  ]
}

export function scopesFor(
  role: WorkspaceRole,
  globalRole: GlobalRole,
  mustChangePassword = false
): string[] {
  if (mustChangePassword) return []
  const scopes = [...roleScopes[role]]
  if (globalRole === 'super_admin') scopes.push('platform:admin')
  return scopes
}
