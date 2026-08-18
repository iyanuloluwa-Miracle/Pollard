import * as vscode from 'vscode';
import { getGitHubEnterpriseHost, getGitLabHost } from '../config';
import { ParsedRemote } from './remoteUrl';
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
    return {
      provider: new GitHubProvider(remote, remote.host === 'github.com' ? undefined : remote.host),
    };
  }
  if (remote.host === 'gitlab.com' || (gitlabInstanceHost && remote.host === gitlabInstanceHost)) {
    return {
      provider: new GitLabProvider(
        context,
        remote,
        remote.host === 'gitlab.com' ? undefined : remote.host
      ),
    };
  }
  return { provider: new NoopProvider(), reason: 'unrecognisedHost' };
}
