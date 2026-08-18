import * as vscode from 'vscode';
import { getGitHubEnterpriseHost, getGitLabHost } from '../config';
import { ParsedRemote } from './remoteUrl';
import { RateLimiter } from './rateLimit';
import { GitHubProvider } from './github/client';
import { GitLabProvider } from './gitlab/client';
import { NoopProvider } from './noop';

export interface PullRequestInfo {
  /** PR number (GitHub) or MR IID (GitLab). */
  id: number;
  url: string;
  title: string;
  state: 'open' | 'closed' | 'merged';
  merged: boolean;
  mergedAt: string | null;
  sourceBranch: string;
}

export interface RateLimitStatus {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
  /** True while in an explicit backoff/cooldown window after a 403/429. */
  isLimited: boolean;
}

export type ProviderId = 'github' | 'gitlab' | 'noop';

/** Tri-state auth status used by pollard.doctor — never exposes the token/session value itself. */
export type AuthProbeStatus = 'signedIn' | 'noSession' | 'tokenInvalid';

export interface Provider {
  readonly id: ProviderId;

  /**
   * Batched PR/MR lookup for many branches in as few round trips as possible.
   * Implementations must not issue one request per branch. Branches with no
   * associated PR/MR are absent from the returned map, not present with [].
   * If `token` is cancelled, implementations check it between network calls
   * (never aborting one already in flight) and return whatever's accumulated
   * so far rather than throwing.
   */
  getPullRequestsForBranches(
    branches: string[],
    token?: vscode.CancellationToken
  ): Promise<Map<string, PullRequestInfo[]>>;

  /** Whether a single branch currently exists on the remote. */
  branchExistsOnRemote(branch: string, token?: vscode.CancellationToken): Promise<boolean>;

  /** Last-known rate-limit state; does not itself trigger a network call. */
  getRateLimitStatus(): RateLimitStatus;
}

const rateLimiterRegistry = new Map<string, RateLimiter>();

/**
 * Providers are constructed fresh on every createProvider() call (once per
 * repo per scan), so a RateLimiter owned by the provider instance itself
 * would be discarded the moment that call returns — pollard.doctor's "last
 * rate limit status" would always read empty. This registry persists one
 * RateLimiter per (kind, host) for the extension host's lifetime instead,
 * shared across every provider instance constructed for that host.
 */
function getSharedRateLimiter(kind: 'github' | 'gitlab', host: string): RateLimiter {
  const key = `${kind}:${host}`;
  let limiter = rateLimiterRegistry.get(key);
  if (!limiter) {
    limiter = new RateLimiter();
    rateLimiterRegistry.set(key, limiter);
  }
  return limiter;
}

/** Last-known rate-limit status for a provider kind + host, without constructing a provider or making a network call. Used by pollard.doctor. */
export function getProviderRateLimitStatus(kind: 'github' | 'gitlab', host: string): RateLimitStatus {
  return getSharedRateLimiter(kind, host).getStatus();
}

export interface CreateProviderOptions {
  context: vscode.ExtensionContext;
  remote: ParsedRemote | undefined;
  /** Repo root path — threads through to gitlabHost/github.enterpriseHost, both resource-scoped settings. */
  resourcePath?: string;
}

export interface CreateProviderResult {
  provider: Provider;
  /** Set only when the provider is a NoopProvider chosen for an explainable reason (as opposed to no remote/host configured at all being unremarkable). */
  reason?: 'noRemote' | 'unrecognisedHost';
}

/**
 * Picks GitHub, GitLab, or a NoopProvider based on the parsed remote's host,
 * matching github.com/gitlab.com or the configured enterprise/self-hosted host.
 */
export function createProvider({
  context,
  remote,
  resourcePath,
}: CreateProviderOptions): CreateProviderResult {
  if (!remote) return { provider: new NoopProvider(), reason: 'noRemote' };

  const githubEnterpriseHost = getGitHubEnterpriseHost(resourcePath);
  const gitlabInstanceHost = getGitLabHost(resourcePath);

  if (
    remote.host === 'github.com' ||
    (githubEnterpriseHost && remote.host === githubEnterpriseHost)
  ) {
    const enterpriseHost = remote.host === 'github.com' ? undefined : remote.host;
    return {
      provider: new GitHubProvider(
        remote,
        enterpriseHost,
        getSharedRateLimiter('github', enterpriseHost ?? 'github.com')
      ),
    };
  }
  if (remote.host === 'gitlab.com' || (gitlabInstanceHost && remote.host === gitlabInstanceHost)) {
    const instanceHost = remote.host === 'gitlab.com' ? undefined : remote.host;
    return {
      provider: new GitLabProvider(
        context,
        remote,
        instanceHost,
        getSharedRateLimiter('gitlab', instanceHost ?? 'gitlab.com')
      ),
    };
  }
  return { provider: new NoopProvider(), reason: 'unrecognisedHost' };
}
