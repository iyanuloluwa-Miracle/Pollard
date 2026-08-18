import { getProtectedBranchPatterns } from '../config';
import { classifyNotAGitRepo, presentError } from '../errors';
import { computeLocalBranchFacts, resolveDefaultBranch } from '../git/branches';
import { PullRequestInfo } from '../providers/provider';
import { primaryRemoteFetchUrl } from '../providers/remoteUrl';
import { buildRepoAssessments, tallyBucketCounts } from '../safety/engine';
import { RepoCache } from '../state/cache';
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
  logChannel,
  telemetry,
}: ScanDeps): Promise<void> {
  await registry.whenReady();
  const repos = registry.repos;
  if (repos.length === 0) {
    presentError(classifyNotAGitRepo(), { logChannel, telemetry, command: 'pollard.refresh' });
    return;
  }

  for (const repo of repos) {
    const defaultBranch = await resolveDefaultBranch(registry, repo);
    const protectedBranchPatterns = getProtectedBranchPatterns(repo.rootPath);
    const localFacts = await computeLocalBranchFacts(
      registry,
      repo,
      defaultBranch,
      protectedBranchPatterns
    );

    const cache = new RepoCache(
      context,
      repo.rootPath,
      primaryRemoteFetchUrl(repo.remotes),
      undefined,
      logChannel
    );
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
