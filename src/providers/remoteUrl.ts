import { pickPrimaryRemoteName } from '../git';
import { RemoteInfo } from '../git';

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

/** Raw fetchUrl of the primary remote — used verbatim as RepoCache's cache-key input. */
export function primaryRemoteFetchUrl(remotes: RemoteInfo[]): string | undefined {
  const primaryName = pickPrimaryRemoteName(remotes);
  return remotes.find((r) => r.name === primaryName)?.fetchUrl;
}

/** Parsed primary remote for provider construction; falls back to any other remote that parses. */
export function resolvePrimaryParsedRemote(remotes: RemoteInfo[]): ParsedRemote | undefined {
  const primary = primaryRemoteFetchUrl(remotes);
  const parsed = primary ? parseGitRemoteUrl(primary) : undefined;
  if (parsed) return parsed;

  for (const r of remotes) {
    const p = r.fetchUrl ? parseGitRemoteUrl(r.fetchUrl) : undefined;
    if (p) return p;
  }
  return undefined;
}
