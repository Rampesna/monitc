export const GIT_CMDS = {
  pull: (path: string, branch?: string): string =>
    branch
      ? `cd '${path}' && git pull origin ${branch} 2>&1`
      : `cd '${path}' && git pull 2>&1`,

  currentBranch: (path: string): string =>
    `cd '${path}' && git rev-parse --abbrev-ref HEAD 2>/dev/null`,

  lastCommit: (path: string): string =>
    `cd '${path}' && git log -1 --format='%H|%h|%an|%ae|%ad|%s' --date=iso-strict 2>/dev/null`,

  remoteBranches: (path: string): string =>
    `cd '${path}' && git ls-remote --heads origin 2>/dev/null | awk '{print $2}' | sed 's|refs/heads/||'`,

  status: (path: string): string =>
    `cd '${path}' && git status --porcelain=v1 -b 2>/dev/null`,

  remotes: (path: string): string =>
    `cd '${path}' && git remote -v 2>/dev/null`,

  fetch: (path: string): string =>
    `cd '${path}' && git fetch --all --prune 2>&1`,

  checkout: (path: string, branch: string): string =>
    `cd '${path}' && git checkout ${branch} 2>&1`,

  log: (path: string, count = 10): string =>
    `cd '${path}' && git log -${count} --format='%H|%h|%an|%ad|%s' --date=iso-strict 2>/dev/null`
}
