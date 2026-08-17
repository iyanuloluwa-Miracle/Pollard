import { ParsedRemote } from '../../git/remote-url';
import { PullRequestInfo } from '../types';

export interface GitLabMergeRequest {
  iid: number;
  title: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  web_url: string;
  source_branch: string;
  merged_at: string | null;
}

export function projectPath(remote: ParsedRemote): string {
  return encodeURIComponent(`${remote.owner}/${remote.repo}`);
}

export function mergeRequestsPageUrl(
  apiBase: string,
  remote: ParsedRemote,
  page: number,
  perPage = 100
): string {
  const params = new URLSearchParams({
    state: 'all',
    order_by: 'updated_at',
    sort: 'desc',
    per_page: String(perPage),
    page: String(page),
  });
  return `${apiBase}/projects/${projectPath(remote)}/merge_requests?${params}`;
}

export function branchUrl(apiBase: string, remote: ParsedRemote, branch: string): string {
  return `${apiBase}/projects/${projectPath(remote)}/repository/branches/${encodeURIComponent(branch)}`;
}

export function toPullRequestInfo(mr: GitLabMergeRequest): PullRequestInfo {
  return {
    id: mr.iid,
    url: mr.web_url,
    title: mr.title,
    state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
    merged: mr.state === 'merged',
    mergedAt: mr.merged_at,
    sourceBranch: mr.source_branch,
  };
}
