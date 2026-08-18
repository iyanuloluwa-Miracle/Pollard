import * as vscode from 'vscode';
import { ParsedRemote } from '../../git/remote-url';
import { AuthRequiredError, InsufficientScopeError } from '../../errors';
import { fetchJson } from '../http';
import { RateLimiter } from '../rate-limit';
import { Provider, PullRequestInfo, RateLimitStatus } from '../types';
import { getGitlabToken } from './gitlab-auth';
import {
  GitLabMergeRequest,
  branchUrl,
  mergeRequestsPageUrl,
  toPullRequestInfo,
} from './gitlab-api';

const MAX_PAGES = 10;

/**
 * GitLab has no scopes header — a 403 with a body mentioning "insufficient
 * scope" is the only signal available, so this is body-text sniffing only.
 * Ambiguous 403s (no such phrase) fall through unclassified to the existing
 * throttle handling, never a confidently-wrong message.
 */
function hasInsufficientScope(status: number, data: unknown): boolean {
  if (status !== 403 || data === undefined) return false;
  return /insufficient[_\s-]?scope/i.test(JSON.stringify(data));
}

/**
 * GitLab's merge_requests endpoint filters by one source_branch at a time —
 * there's no OR-filter across branches, so the real batching lever is
 * paginating the full MR list once and indexing it client-side by branch,
 * rather than issuing one request per branch. Sorted by most-recently-updated
 * so requested branches are usually found within the first page or two, and
 * pagination stops as soon as every requested branch has been located.
 */
async function fetchMergeRequestsIndex(
  apiBase: string,
  remote: ParsedRemote,
  privateToken: string,
  wantedBranches: Set<string>,
  rateLimiter: RateLimiter,
  cancellationToken?: vscode.CancellationToken
): Promise<Map<string, GitLabMergeRequest[]>> {
  const index = new Map<string, GitLabMergeRequest[]>();
  const found = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (cancellationToken?.isCancellationRequested) break;
    rateLimiter.throwIfLimited();
    const url = mergeRequestsPageUrl(apiBase, remote, page);
    const { data, response } = await fetchJson<GitLabMergeRequest[]>(url, {
      headers: { 'PRIVATE-TOKEN': privateToken },
    });

    if (hasInsufficientScope(response.status, data)) {
      throw new InsufficientScopeError('gitlab');
    }
    if (response.status === 403 || response.status === 429) {
      rateLimiter.noteThrottled(response.headers.get('retry-after'));
      break;
    }
    rateLimiter.updateFromHeaders(response.headers, 'gitlab');

    for (const mr of data ?? []) {
      if (!index.has(mr.source_branch)) index.set(mr.source_branch, []);
      index.get(mr.source_branch)?.push(mr);
      if (wantedBranches.has(mr.source_branch)) found.add(mr.source_branch);
    }

    const nextPage = response.headers.get('x-next-page');
    if (!nextPage || found.size === wantedBranches.size) break;
  }
  return index;
}

export class GitLabProvider implements Provider {
  readonly id = 'gitlab' as const;

  private readonly rateLimiter = new RateLimiter();
  private readonly apiBase: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly remote: ParsedRemote,
    instanceHost?: string
  ) {
    this.apiBase = `https://${instanceHost ?? 'gitlab.com'}/api/v4`;
  }

  async getPullRequestsForBranches(
    branches: string[],
    token?: vscode.CancellationToken
  ): Promise<Map<string, PullRequestInfo[]>> {
    this.rateLimiter.throwIfLimited();
    const privateToken = await getGitlabToken(this.context);
    if (!privateToken) throw new AuthRequiredError('gitlab');

    const index = await fetchMergeRequestsIndex(
      this.apiBase,
      this.remote,
      privateToken,
      new Set(branches),
      this.rateLimiter,
      token
    );

    const out = new Map<string, PullRequestInfo[]>();
    for (const branch of branches) {
      const mrs = index.get(branch);
      if (mrs?.length) out.set(branch, mrs.map(toPullRequestInfo));
    }
    return out;
  }

  async branchExistsOnRemote(branch: string, token?: vscode.CancellationToken): Promise<boolean> {
    this.rateLimiter.throwIfLimited();
    if (token?.isCancellationRequested) return false;
    const privateToken = await getGitlabToken(this.context);
    if (!privateToken) throw new AuthRequiredError('gitlab');

    const { data, response } = await fetchJson(branchUrl(this.apiBase, this.remote, branch), {
      headers: { 'PRIVATE-TOKEN': privateToken },
    });
    if (hasInsufficientScope(response.status, data)) {
      throw new InsufficientScopeError('gitlab');
    }
    if (response.status === 403 || response.status === 429) {
      this.rateLimiter.noteThrottled(response.headers.get('retry-after'));
    }
    this.rateLimiter.updateFromHeaders(response.headers, 'gitlab');
    return response.status === 200;
  }

  getRateLimitStatus(): RateLimitStatus {
    return this.rateLimiter.getStatus();
  }
}
