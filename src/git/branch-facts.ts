import { Ref } from './git-api-types';
import { REF_TYPE_REMOTE_HEAD, pickPrimaryRemoteName } from './git-extension';
import { matchesAnyPattern } from './protected-branches';
import { RepoHandle, RepoRegistry } from './repo-registry';
import { BranchFacts, MergeStatus } from '../safety/engine';
import { mapWithConcurrency } from '../util/concurrency';

export interface DefaultBranchInfo {
  name: string;
  sha: string;
}

const ANCESTOR_CHECK_MAX_BRANCHES = 60;
/** Bounds how many branches' worth of git subprocess calls (via the vscode.git extension's merge-base/branch lookups) are in flight at once — a 200-branch repo must not fire 200 at once, nor crawl fully serially. */
const BRANCH_FACTS_CONCURRENCY = 4;

function stripRemotePrefix(ref: Ref): string | undefined {
  if (!ref.name) return undefined;
  if (ref.remote && ref.name.startsWith(`${ref.remote}/`))
    return ref.name.slice(ref.remote.length + 1);
  return ref.name;
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

async function computeMergeStatus(
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
 * Capped at ANCESTOR_CHECK_MAX_BRANCHES — safe because engine.ts never
 * references this field in scoring or reasons text (it's informational
 * only), so skipping it entirely above the cap has no user-visible cost.
 */
async function computeIsAncestorOfAnotherLocalBranch(
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

/** Computes every local branch's facts (everything except pullRequest) for one repo. */
export async function computeLocalBranchFacts(
  registry: RepoRegistry,
  repo: RepoHandle,
  defaultBranch: DefaultBranchInfo | undefined,
  protectedBranchPatterns: string[]
): Promise<Map<string, Omit<BranchFacts, 'pullRequest'>>> {
  const allRefs = registry.getRefs(repo.id) ?? [];
  const remoteRefs = allRefs.filter((r) => r.type === REF_TYPE_REMOTE_HEAD);

  const entries = await mapWithConcurrency(
    repo.branches,
    BRANCH_FACTS_CONCURRENCY,
    async (branch): Promise<[string, Omit<BranchFacts, 'pullRequest'>]> => {
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
  return new Map(entries);
}
