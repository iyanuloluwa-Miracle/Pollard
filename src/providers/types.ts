import type { CancellationToken } from 'vscode';

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
    token?: CancellationToken
  ): Promise<Map<string, PullRequestInfo[]>>;

  /** Whether a single branch currently exists on the remote. */
  branchExistsOnRemote(branch: string, token?: CancellationToken): Promise<boolean>;

  /** Last-known rate-limit state; does not itself trigger a network call. */
  getRateLimitStatus(): RateLimitStatus;
}
