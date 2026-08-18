import * as vscode from 'vscode';
import { Ref, REF_TYPE_REMOTE_HEAD, RemoteInfo } from './types';
import { computeIsAncestorOfAnotherLocalBranch, computeMergeStatus } from './merge';
import { matchesAnyPattern } from '../safety';
import { BranchFacts } from '../safety';
import { mapWithConcurrency } from '../util';
import { RepoHandle, RepoRegistry } from '../workspace';

export interface DefaultBranchInfo {
  name: string;
  sha: string;
}

/** Bounds how many branches' worth of git subprocess calls (via the vscode.git extension's merge-base/branch lookups) are in flight at once — a 200-branch repo must not fire 200 at once, nor crawl fully serially. */
const BRANCH_FACTS_CONCURRENCY = 4;

function stripRemotePrefix(ref: Ref): string | undefined {
  if (!ref.name) return undefined;
  if (ref.remote && ref.name.startsWith(`${ref.remote}/`))
    return ref.name.slice(ref.remote.length + 1);
  return ref.name;
}

/** 'origin' if present, else the first remote, else undefined. */
export function pickPrimaryRemoteName(remotes: RemoteInfo[]): string | undefined {
  return remotes.some((r) => r.name === 'origin') ? 'origin' : remotes[0]?.name;
}

/**
 * Resolves the repo's default branch, never throwing. Falls back through:
 * the primary remote's symbolic HEAD ref, then a local `main`/`master`,
 * then a remote-tracking `main`/`master`, then gives up (undefined) — every
 * branch in that repo then gets `mergeStatus: 'unknown'`, which still lets
 * PR-derived statuses work.
 */
export async function resolveDefaultBranch(
  registry: RepoRegistry,
  repo: RepoHandle
): Promise<DefaultBranchInfo | undefined> {
  const primaryRemote = pickPrimaryRemoteName(repo.remotes);
  const allRefs = registry.getRefs(repo.id) ?? [];
  const remoteRefs = allRefs.filter((r) => r.type === REF_TYPE_REMOTE_HEAD);

  if (primaryRemote) {
    const headRef = remoteRefs.find(
      (r) =>
        r.commit &&
        (r.remote === primaryRemote || r.name === `${primaryRemote}/HEAD`) &&
        stripRemotePrefix(r) === 'HEAD'
    );
    if (headRef?.commit) {
      const sibling = remoteRefs.find(
        (r) =>
          r !== headRef &&
          r.commit === headRef.commit &&
          (r.remote === primaryRemote || r.name?.startsWith(`${primaryRemote}/`)) &&
          stripRemotePrefix(r) !== 'HEAD'
      );
      const name = sibling ? stripRemotePrefix(sibling) : undefined;
      if (name) return { name, sha: headRef.commit };
    }
  }

  for (const candidate of ['main', 'master']) {
    const local = repo.branches.find((b) => b.name === candidate);
    if (local) return { name: candidate, sha: local.sha };
  }

  if (primaryRemote) {
    for (const candidate of ['main', 'master']) {
      const ref = remoteRefs.find(
        (r) =>
          (r.remote === primaryRemote || r.name === `${primaryRemote}/${candidate}`) &&
          stripRemotePrefix(r) === candidate &&
          r.commit
      );
      if (ref?.commit) return { name: candidate, sha: ref.commit };
    }
  }

  return undefined;
}

/** Local tip contained in (or equal to) what's on the remote — correctly handles the remote being ahead too. */
async function computeIsPushed(
  registry: RepoRegistry,
  repoId: string,
  branchName: string,
  branchSha: string,
  remoteRefs: Ref[]
): Promise<boolean> {
  for (const ref of remoteRefs) {
    if (!ref.commit || stripRemotePrefix(ref) !== branchName) continue;
    if (ref.commit === branchSha) return true;
    const base = await registry.getMergeBase(repoId, branchSha, ref.commit);
    if (base === branchSha) return true;
  }
  return false;
}

/** Local knowledge only (from the last fetch) — not a live network call. */
function computeExistsOnRemote(remoteRefs: Ref[], branchName: string): boolean {
  return remoteRefs.some((r) => stripRemotePrefix(r) === branchName);
}

async function computeUpstreamIsGone(
  registry: RepoRegistry,
  repoId: string,
  branchName: string,
  remoteRefs: Ref[]
): Promise<boolean> {
  const branch = await registry.getBranchDetails(repoId, branchName);
  if (!branch?.upstream) return false;
  const { remote, name } = branch.upstream;
  const stillExists = remoteRefs.some((r) => r.remote === remote && stripRemotePrefix(r) === name);
  return !stillExists;
}

/**
 * Computes every local branch's facts (everything except pullRequest) for
 * one repo. If `token` is cancelled mid-computation, branches not yet
 * started are skipped and simply absent from the returned map — the caller
 * treats a missing branch the same as one phase 1 never reached.
 */
export async function computeLocalBranchFacts(
  registry: RepoRegistry,
  repo: RepoHandle,
  defaultBranch: DefaultBranchInfo | undefined,
  protectedBranchPatterns: string[],
  token?: vscode.CancellationToken
): Promise<Map<string, Omit<BranchFacts, 'pullRequest'>>> {
  const allRefs = registry.getRefs(repo.id) ?? [];
  const remoteRefs = allRefs.filter((r) => r.type === REF_TYPE_REMOTE_HEAD);

  const entries = await mapWithConcurrency(
    repo.branches,
    BRANCH_FACTS_CONCURRENCY,
    async (branch): Promise<[string, Omit<BranchFacts, 'pullRequest'>] | undefined> => {
      if (token?.isCancellationRequested) return undefined;

      const [mergeStatus, isPushed, upstreamIsGone, isAncestorOfAnotherLocalBranch] =
        await Promise.all([
          computeMergeStatus(registry, repo.id, branch.sha, defaultBranch?.sha),
          computeIsPushed(registry, repo.id, branch.name, branch.sha, remoteRefs),
          computeUpstreamIsGone(registry, repo.id, branch.name, remoteRefs),
          computeIsAncestorOfAnotherLocalBranch(
            registry,
            repo.id,
            branch.name,
            branch.sha,
            repo.branches
          ),
        ]);

      return [
        branch.name,
        {
          isCurrent: branch.name === repo.currentBranch,
          isProtected:
            (defaultBranch !== undefined && branch.name === defaultBranch.name) ||
            matchesAnyPattern(branch.name, protectedBranchPatterns),
          mergeStatus,
          isPushed,
          existsOnRemote: computeExistsOnRemote(remoteRefs, branch.name),
          upstreamIsGone,
          isAncestorOfAnotherLocalBranch,
        },
      ];
    }
  );
  return new Map(entries.filter((e) => e !== undefined));
}
