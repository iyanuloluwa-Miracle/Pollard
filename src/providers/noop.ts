import type { Provider, PullRequestInfo, RateLimitStatus } from './provider';

/**
 * Fallback for repos with no recognised remote. Every method resolves
 * immediately with a safe default and never throws. `branchExistsOnRemote`
 * returning false means "no remote to check", not "confirmed absent" —
 * callers that need to distinguish those should check `provider.id === 'noop'`
 * before treating it as proof a branch is safe to delete.
 */
export class NoopProvider implements Provider {
  readonly id = 'noop' as const;

  async getPullRequestsForBranches(): Promise<Map<string, PullRequestInfo[]>> {
    return new Map();
  }

  async branchExistsOnRemote(): Promise<boolean> {
    return false;
  }

  getRateLimitStatus(): RateLimitStatus {
    return { limit: null, remaining: null, resetAt: null, isLimited: false };
  }
}
