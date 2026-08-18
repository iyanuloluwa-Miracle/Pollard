import type { CancellationToken } from 'vscode';
import { ParsedRemote } from '../../git/remote-url';
import { AuthRequiredError, InsufficientScopeError } from '../../errors';
import { fetchJson } from '../http';
import { RateLimiter } from '../rate-limit';
import { Provider, PullRequestInfo, RateLimitStatus } from '../types';
import { getGithubSession } from './github-auth';
import {
  GithubBatchResponseData,
  GithubRefExistsResponseData,
  buildBatchRefsQuery,
  buildRefExistsQuery,
  chunkBranches,
  parseBatchRefsResponse,
} from './github-queries';

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

/**
 * GitHub returns 403 both for scope-denied requests and for secondary rate
 * limiting — conflating the two would corrupt the rate limiter's cooldown
 * state on an ordinary scope problem, so this check runs first and, when it
 * matches, short-circuits before the throttle bookkeeping ever sees the 403.
 */
function hasInsufficientScope<T>(
  response: Response,
  data: GraphQLResponse<T> | undefined
): boolean {
  const accepted = response.headers
    .get('x-accepted-oauth-scopes')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (accepted && accepted.length > 0) {
    const granted = new Set(
      (response.headers.get('x-oauth-scopes') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    if (!accepted.some((s) => granted.has(s))) return true;
  }
  return data?.errors?.some((e) => /insufficient.*scope/i.test(e.message)) ?? false;
}

export class GitHubProvider implements Provider {
  readonly id = 'github' as const;

  private readonly rateLimiter = new RateLimiter();
  private readonly graphqlUrl: string;

  constructor(
    private readonly remote: ParsedRemote,
    enterpriseHost?: string
  ) {
    this.graphqlUrl = enterpriseHost
      ? `https://${enterpriseHost}/api/graphql`
      : 'https://api.github.com/graphql';
  }

  async getPullRequestsForBranches(
    branches: string[],
    token?: CancellationToken
  ): Promise<Map<string, PullRequestInfo[]>> {
    this.rateLimiter.throwIfLimited();
    const session = await getGithubSession(false);
    if (!session) throw new AuthRequiredError('github');

    const result = new Map<string, PullRequestInfo[]>();
    for (const chunk of chunkBranches(branches)) {
      if (token?.isCancellationRequested) break;
      const { query, variables, aliasToBranch } = buildBatchRefsQuery(
        this.remote.owner,
        this.remote.repo,
        chunk
      );
      const { data, response } = await fetchJson<GraphQLResponse<GithubBatchResponseData>>(
        this.graphqlUrl,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${session.accessToken}` },
          body: { query, variables },
        }
      );
      if (hasInsufficientScope(response, data)) throw new InsufficientScopeError('github');
      this.recordResponse(response);
      if (data?.data?.rateLimit) this.rateLimiter.updateFromGraphQLRateLimit(data.data.rateLimit);
      for (const [branch, prs] of parseBatchRefsResponse(data?.data, aliasToBranch)) {
        result.set(branch, prs);
      }
    }
    return result;
  }

  async branchExistsOnRemote(branch: string, token?: CancellationToken): Promise<boolean> {
    this.rateLimiter.throwIfLimited();
    if (token?.isCancellationRequested) return false;
    const session = await getGithubSession(false);
    if (!session) throw new AuthRequiredError('github');

    const { query, variables } = buildRefExistsQuery(this.remote.owner, this.remote.repo, branch);
    const { data, response } = await fetchJson<GraphQLResponse<GithubRefExistsResponseData>>(
      this.graphqlUrl,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: { query, variables },
      }
    );
    if (hasInsufficientScope(response, data)) throw new InsufficientScopeError('github');
    this.recordResponse(response);
    if (data?.data?.rateLimit) this.rateLimiter.updateFromGraphQLRateLimit(data.data.rateLimit);
    return data?.data?.repository?.ref !== null && data?.data?.repository?.ref !== undefined;
  }

  getRateLimitStatus(): RateLimitStatus {
    return this.rateLimiter.getStatus();
  }

  private recordResponse(response: Response): void {
    if (response.status === 403 || response.status === 429) {
      this.rateLimiter.noteThrottled(response.headers.get('retry-after'));
    }
    this.rateLimiter.updateFromHeaders(response.headers, 'github');
  }
}
