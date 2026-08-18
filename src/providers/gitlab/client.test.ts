import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientScopeError, RateLimitedError } from '../../errors';
import { GitLabProvider } from './client';

interface FakeContext {
  secrets: { get: () => Promise<string | undefined>; store: () => Promise<void> };
}

function fakeContext(token: string | undefined = 'fake-gitlab-pat'): FakeContext {
  return { secrets: { get: async () => token, store: async () => {} } };
}

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

describe('GitLabProvider', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('happy path: single-page MR list returns only branches with MRs', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(
        [
          {
            iid: 1,
            title: 'Add feature',
            state: 'opened',
            web_url: 'https://gitlab.com/o/r/-/merge_requests/1',
            source_branch: 'feature/has-mr',
            merged_at: null,
          },
        ],
        { headers: {} }
      )
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new GitLabProvider(fakeContext() as any, {
      host: 'gitlab.com',
      owner: 'o',
      repo: 'r',
    });
    const result = await provider.getPullRequestsForBranches(['feature/has-mr', 'feature/no-mr']);

    expect(result.has('feature/has-mr')).toBe(true);
    expect(result.has('feature/no-mr')).toBe(false);
  });

  it('rate-limit response: first call absorbs it, second call short-circuits without hitting fetch again', async () => {
    const fetchMock = vi.fn(async () => textResponse('rate limited', { status: 403 }));
    global.fetch = fetchMock;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new GitLabProvider(fakeContext() as any, {
      host: 'gitlab.com',
      owner: 'o',
      repo: 'r',
    });
    await expect(provider.getPullRequestsForBranches(['feature/x'])).resolves.toBeInstanceOf(Map);
    expect(provider.getRateLimitStatus().isLimited).toBe(true);

    await expect(provider.getPullRequestsForBranches(['feature/x'])).rejects.toBeInstanceOf(
      RateLimitedError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('malformed response: non-JSON body resolves to an empty map instead of throwing', async () => {
    global.fetch = vi.fn(async () => textResponse('<html>Internal Server Error</html>'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new GitLabProvider(fakeContext() as any, {
      host: 'gitlab.com',
      owner: 'o',
      repo: 'r',
    });
    const result = await provider.getPullRequestsForBranches(['feature/x']);

    expect(result.size).toBe(0);
  });

  it('insufficient scope: throws InsufficientScopeError and does not trip the rate limiter', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({ message: '403 Insufficient scope' }, { status: 403 })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new GitLabProvider(fakeContext() as any, {
      host: 'gitlab.com',
      owner: 'o',
      repo: 'r',
    });
    await expect(provider.getPullRequestsForBranches(['feature/x'])).rejects.toBeInstanceOf(
      InsufficientScopeError
    );
    expect(provider.getRateLimitStatus().isLimited).toBe(false);
  });
});
