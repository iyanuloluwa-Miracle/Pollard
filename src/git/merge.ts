import { RepoRegistry } from '../workspace/repositories';
import { MergeStatus } from '../safety/types';

/** Bounds how many branches' worth of git subprocess calls (via the vscode.git extension's merge-base/branch lookups) are in flight at once — a 200-branch repo must not fire 200 at once, nor crawl fully serially. */
const ANCESTOR_CHECK_MAX_BRANCHES = 60;

export async function computeMergeStatus(
  registry: RepoRegistry,
  repoId: string,
  branchSha: string,
  defaultSha: string | undefined
): Promise<MergeStatus> {
  if (!defaultSha) return 'unknown';
  if (branchSha === defaultSha) return 'merged';
  const base = await registry.getMergeBase(repoId, branchSha, defaultSha);
  if (base === undefined) return 'unknown';
  return base === branchSha ? 'merged' : 'not_merged';
}

/**
 * Capped at ANCESTOR_CHECK_MAX_BRANCHES — safe because engine.ts never
 * references this field in scoring or reasons text (it's informational
 * only), so skipping it entirely above the cap has no user-visible cost.
 */
export async function computeIsAncestorOfAnotherLocalBranch(
  registry: RepoRegistry,
  repoId: string,
  branchName: string,
  branchSha: string,
  allBranches: { name: string; sha: string }[]
): Promise<boolean> {
  if (allBranches.length > ANCESTOR_CHECK_MAX_BRANCHES) return false;
  for (const other of allBranches) {
    if (other.name === branchName) continue;
    if (other.sha === branchSha) return true;
    const base = await registry.getMergeBase(repoId, branchSha, other.sha);
    if (base === branchSha) return true;
  }
  return false;
}
