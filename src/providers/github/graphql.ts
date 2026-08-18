import { PullRequestInfo } from '../provider';

/**
 * Community-observed safe ceiling for GraphQL alias count before hitting
 * query-complexity/timeout errors. GitHub publishes no hard limit.
 */
export const GITHUB_BATCH_SIZE = 50;

export interface GithubBatchQuery {
  query: string;
  variables: Record<string, string>;
  aliasToBranch: Map<string, string>;
}

/**
 * Builds a single GraphQL query that looks up many branches' associated pull
 * requests in one round trip, by aliasing the `ref` field per branch under a
 * shared `repository(owner, name)` selection (aliasing the whole repository
 * per branch, as opposed to just `ref`, would redundantly resolve the same
 * node N times for no benefit). Branch names are passed as variables, not
 * string-interpolated, to avoid escaping concerns.
 */
export function buildBatchRefsQuery(
  owner: string,
  repo: string,
  branches: string[]
): GithubBatchQuery {
  const aliasToBranch = new Map<string, string>();
  const varDecls: string[] = ['$owner: String!', '$name: String!'];
  const fields: string[] = [];
  const variables: Record<string, string> = { owner, name: repo };

  branches.forEach((branch, i) => {
    const alias = `b${i}`;
    const varName = `branch${i}`;
    aliasToBranch.set(alias, branch);
    varDecls.push(`$${varName}: String!`);
    variables[varName] = `refs/heads/${branch}`;
    fields.push(`
      ${alias}: ref(qualifiedName: $${varName}) {
        name
        associatedPullRequests(first: 5, states: [OPEN, MERGED, CLOSED]) {
          nodes { number title state url merged mergedAt headRefName }
        }
      }`);
  });

  const query = `query BatchBranchPRs(${varDecls.join(', ')}) {
    repository(owner: $owner, name: $name) { ${fields.join('\n')} }
    rateLimit { limit remaining resetAt cost }
  }`;

  return { query, variables, aliasToBranch };
}

/** A lean query for a single branch's existence, without pulling PR data. */
export function buildRefExistsQuery(
  owner: string,
  repo: string,
  branch: string
): { query: string; variables: Record<string, string> } {
  const query = `query RefExists($owner: String!, $name: String!, $branch: String!) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $branch) { name }
    }
    rateLimit { limit remaining resetAt cost }
  }`;
  return { query, variables: { owner, name: repo, branch: `refs/heads/${branch}` } };
}

export function chunkBranches(branches: string[], size = GITHUB_BATCH_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < branches.length; i += size) out.push(branches.slice(i, i + size));
  return out;
}

interface GithubPullRequestNode {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  merged: boolean;
  mergedAt: string | null;
  headRefName: string;
}

interface GithubRefResult {
  name: string;
  associatedPullRequests: { nodes: GithubPullRequestNode[] } | null;
}

export interface GithubRateLimitField {
  limit: number;
  remaining: number;
  resetAt: string;
  cost: number;
}

export interface GithubBatchResponseData {
  repository: Record<string, GithubRefResult | null> | null;
  rateLimit: GithubRateLimitField | null;
}

export interface GithubRefExistsResponseData {
  repository: { ref: { name: string } | null } | null;
  rateLimit: GithubRateLimitField | null;
}

export function parseBatchRefsResponse(
  data: GithubBatchResponseData | undefined,
  aliasToBranch: Map<string, string>
): Map<string, PullRequestInfo[]> {
  const out = new Map<string, PullRequestInfo[]>();
  if (!data?.repository) return out;

  for (const [alias, branch] of aliasToBranch) {
    const ref = data.repository[alias];
    const nodes = ref?.associatedPullRequests?.nodes ?? [];
    if (nodes.length === 0) continue;

    out.set(
      branch,
      nodes.map((n) => ({
        id: n.number,
        url: n.url,
        title: n.title,
        state: n.merged ? 'merged' : n.state === 'OPEN' ? 'open' : 'closed',
        merged: n.merged,
        mergedAt: n.mergedAt,
        sourceBranch: branch,
      }))
    );
  }
  return out;
}
