export interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
}

const REMOTE_URL_PATTERNS = [
  /^git@([^:]+):(.+?)(?:\.git)?\/?$/, // git@host:owner/repo(.git)
  /^ssh:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/, // ssh://[user@]host/owner/repo(.git)
  /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/, // https://[user@]host/owner/repo(.git)
];

/**
 * Parses a git remote URL into {host, owner, repo}, handling ssh (scp-style
 * and ssh://), https, and non-github.com/gitlab.com (enterprise/self-hosted)
 * hosts. `owner` joins all path segments but the last, so GitLab-style nested
 * groups (e.g. `group/subgroup/repo`) are preserved.
 */
export function parseGitRemoteUrl(url: string): ParsedRemote | undefined {
  for (const pattern of REMOTE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (!match) continue;

    const host = match[1].toLowerCase();
    const path = match[2].replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);
    if (segments.length < 2) continue;

    const repo = segments[segments.length - 1];
    const owner = segments.slice(0, -1).join('/');
    return { host, owner, repo };
  }
  return undefined;
}
