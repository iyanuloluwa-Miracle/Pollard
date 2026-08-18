import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authState } from '../../../test/vscode-stub';
import { InsufficientScopeError, RateLimitedError } from '../../errors';
import { GitHubProvider } from './github-provider';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(body, { status: init.status ?? 200, headers: init.headers });
}

describe('GitHubProvider', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    authState.githubSession = { accessToken: 'fake-github-token' };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('happy path: batched lookup returns only branches with PRs', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          repository: {
            b0: {
              name: 'refs/heads/feature/has-pr',
              associatedPullRequests: {
                nodes: [
                  {
                    number: 1,
                    title: 'Add feature',
                    state: 'OPEN',
                    url: 'https://github.com/o/r/pull/1',
                    merged: false,
                    mergedAt: null,
                    headRefName: 'feature/has-pr',
                  },
                ],
              },
            },
            b1: { name: 'refs/heads/feature/no-pr', associatedPullRequests: { nodes: [] } },
          },
          rateLimit: { limit: 5000, remaining: 4999, resetAt: new Date().toISOString(), cost: 1 },
        },
      })
    );

    const provider = new GitHubProvider({ host: 'github.com', owner: 'o', repo: 'r' });
    const result = await provider.getPullRequestsForBranches(['feature/has-pr', 'feature/no-pr']);

    expect(result.has('feature/has-pr')).toBe(true);
    expect(result.get('feature/has-pr')).toHaveLength(1);
    expect(result.has('feature/no-pr')).toBe(false);
  });

  it('rate-limit response: first call absorbs it, second call short-circuits without hitting fetch again', async () => {
    const fetchMock = vi.fn(async () => textResponse('rate limited', { status: 403 }));
    global.fetch = fetchMock;

    const provider = new GitHubProvider({ host: 'github.com', owner: 'o', repo: 'r' });
    await expect(provider.getPullRequestsForBranches(['feature/x'])).resolves.toBeInstanceOf(Map);
    expect(provider.getRateLimitStatus().isLimited).toBe(true);

    await expect(provider.getPullRequestsForBranches(['feature/x'])).rejects.toBeInstanceOf(
      RateLimitedError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('malformed response: non-JSON body resolves to an empty map instead of throwing', async () => {
    global.fetch = vi.fn(async () => textResponse('<html>Internal Server Error</html>'));

    const provider = new GitHubProvider({ host: 'github.com', owner: 'o', repo: 'r' });
    const result = await provider.getPullRequestsForBranches(['feature/x']);

    expect(result.size).toBe(0);
  });

  it('insufficient scope: throws InsufficientScopeError and does not trip the rate limiter', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(
        { data: null },
        {
          status: 403,
          headers: {
            'x-accepted-oauth-scopes': 'repo',
            'x-oauth-scopes': 'public_repo',
          },
        }
      )
    );

    const provider = new GitHubProvider({ host: 'github.com', owner: 'o', repo: 'r' });
    await expect(provider.getPullRequestsForBranches(['feature/x'])).rejects.toBeInstanceOf(
      InsufficientScopeError
    );
    expect(provider.getRateLimitStatus().isLimited).toBe(false);
  });
});
