import * as vscode from 'vscode';
import { getProtectedBranchPatterns } from '../config';
import { computeLocalBranchFacts, resolveDefaultBranch } from '../git/branch-facts';
import { primaryRemoteFetchUrl, resolvePrimaryParsedRemote } from '../git/git-extension';
import { AuthRequiredError, RateLimitedError } from '../providers/errors';
import { getGithubSession } from '../providers/github/github-auth';
import { getGitlabToken } from '../providers/gitlab/gitlab-auth';
import { createProvider } from '../providers/provider-factory';
import { PullRequestInfo } from '../providers/types';
import { BranchFacts } from '../safety/engine';
import { RepoCache } from '../state/cache';
import { buildRepoAssessments, tallyBucketCounts } from './assess';
import { ScanDeps } from './types';

let scanInFlight: Promise<void> | undefined;

/** Entry point for pollard.scan. Deduped: a concurrent call (manual click during an auto-triggered scan, or vice versa) reuses the in-flight run rather than racing it. */
export function runScan(deps: ScanDeps): Promise<void> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = doRunScan(deps).finally(() => {
    scanInFlight = undefined;
  });
  return scanInFlight;
}

async function doRunScan({
  context,
  registry,
  branchTreeProvider,
  statusBar,
}: ScanDeps): Promise<void> {
  const repos = registry.repos;
  if (repos.length === 0) {
    vscode.window.showInformationMessage('Pollard: No Git repository found in this workspace.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Pollard: Scanning',
      cancellable: true,
    },
    async (progress, token) => {
      const WEIGHTS = { local: 20, network: 50, assess: 30 };
      const localIncrement = WEIGHTS.local / repos.length;
      const networkIncrement = WEIGHTS.network / repos.length;
      const assessIncrement = WEIGHTS.assess / repos.length;

      // Phase 1 — reading local branches (no network).
      progress.report({ message: 'Reading local branches…' });
      const localFactsByRepo = new Map<string, Map<string, Omit<BranchFacts, 'pullRequest'>>>();
      for (const repo of repos) {
        if (token.isCancellationRequested) break;
        const defaultBranch = await resolveDefaultBranch(registry, repo);
        const protectedBranchPatterns = getProtectedBranchPatterns(repo.rootPath);
        localFactsByRepo.set(
          repo.id,
          await computeLocalBranchFacts(registry, repo, defaultBranch, protectedBranchPatterns)
        );
        progress.report({ increment: localIncrement });
      }

      // Phase 2 — querying GitHub/GitLab. Cache reads are never gated by the
      // token — that's what lets a cancelled scan still upgrade a repo using
      // already-cached PR data, not just bare local facts.
      progress.report({ message: 'Querying GitHub/GitLab…' });
      const prsByRepo = new Map<string, Map<string, PullRequestInfo[]>>();
      const freshPrsByRepo = new Map<string, Map<string, PullRequestInfo[]>>();
      const cachesByRepo = new Map<string, RepoCache>();
      let anyAuthNeeded = false;
      let signedIn = true;

      for (const repo of repos) {
        const localFacts = localFactsByRepo.get(repo.id);
        if (!localFacts) continue; // phase 1 never reached this repo (cancelled early)

        const cache = new RepoCache(context, repo.rootPath, primaryRemoteFetchUrl(repo.remotes));
        cachesByRepo.set(repo.id, cache);

        const prMap = new Map<string, PullRequestInfo[]>();
        const uncached: string[] = [];
        for (const name of localFacts.keys()) {
          const cached = await cache.getPullRequests(name);
          if (cached !== undefined) prMap.set(name, cached);
          else uncached.push(name);
        }

        const parsedRemote = resolvePrimaryParsedRemote(repo.remotes);
        const provider = createProvider({
          context,
          remote: parsedRemote,
          resourcePath: repo.rootPath,
        });

        if (provider.id !== 'noop') {
          anyAuthNeeded = true;
          const authed =
            provider.id === 'github'
              ? !!(await getGithubSession(false))
              : !!(await getGitlabToken(context));
          if (!authed) {
            signedIn = false;
          } else if (uncached.length > 0 && !token.isCancellationRequested) {
            try {
              const fetched = await provider.getPullRequestsForBranches(uncached, token);
              const fresh = new Map<string, PullRequestInfo[]>();
              for (const name of uncached) {
                const prs = fetched.get(name) ?? []; // record a miss too, so a re-scan within the TTL is free
                prMap.set(name, prs);
                fresh.set(name, prs);
              }
              freshPrsByRepo.set(repo.id, fresh);
            } catch (err) {
              if (err instanceof AuthRequiredError) {
                signedIn = false;
              } else if (err instanceof RateLimitedError) {
                vscode.window.showWarningMessage(
                  `Pollard: ${provider.id} rate limit reached — showing local + cached results only.`
                );
              }
              // Any other failure: this repo just falls back to local + already-cached PR data.
            }
          }
        }
        prsByRepo.set(repo.id, prMap);
        progress.report({ increment: networkIncrement });
      }

      void vscode.commands.executeCommand(
        'setContext',
        'pollard.isSignedIn',
        !anyAuthNeeded || signedIn
      );

      // Phase 3 — assessing.
      progress.report({ message: 'Assessing…' });
      for (const repo of repos) {
        const localFacts = localFactsByRepo.get(repo.id);
        if (!localFacts) continue;
        const assessments = buildRepoAssessments(localFacts, prsByRepo.get(repo.id) ?? new Map());

        const fresh = freshPrsByRepo.get(repo.id);
        if (fresh?.size) await cachesByRepo.get(repo.id)?.setPullRequests(fresh);

        branchTreeProvider.updateAssessments(repo.id, assessments);
        statusBar.setRepoCounts(repo.id, tallyBucketCounts(assessments));
        progress.report({ increment: assessIncrement });
      }
    }
  );
}
