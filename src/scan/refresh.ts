import { computeLocalBranchFacts, resolveDefaultBranch } from '../git/branch-facts';
import { primaryRemoteFetchUrl } from '../git/git-extension';
import { PullRequestInfo } from '../providers/types';
import { RepoCache } from '../state/cache';
import { buildRepoAssessments, tallyBucketCounts } from './assess';
import { ScanDeps } from './types';

/**
 * Entry point for pollard.refresh. No withProgress, no provider construction,
 * no auth check, no network call of any kind — recomputes local git facts
 * fresh (branches may have moved) and combines them with whatever's in
 * RepoCache right now.
 */
export async function runRefresh({
  context,
  registry,
  branchTreeProvider,
  statusBar,
}: ScanDeps): Promise<void> {
  for (const repo of registry.repos) {
    const defaultBranch = await resolveDefaultBranch(registry, repo);
    const localFacts = await computeLocalBranchFacts(registry, repo, defaultBranch);

    const cache = new RepoCache(context, repo.rootPath, primaryRemoteFetchUrl(repo.remotes));
    const prsByBranch = new Map<string, PullRequestInfo[]>();
    for (const name of localFacts.keys()) {
      const cached = await cache.getPullRequests(name);
      if (cached) prsByBranch.set(name, cached);
    }

    const assessments = buildRepoAssessments(localFacts, prsByBranch);
    branchTreeProvider.updateAssessments(repo.id, assessments);
    statusBar.setRepoCounts(repo.id, tallyBucketCounts(assessments));
  }
}
