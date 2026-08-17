import * as path from 'path';
import * as vscode from 'vscode';
import { Branch, GitExtension, Ref, Repository } from './git-api-types';
import { REF_TYPE_HEAD, RemoteInfo } from './git-extension';

export interface RepoHandle {
  /** === Repository.rootUri.fsPath. Stable, unique, no separate ID scheme needed. */
  id: string;
  rootPath: string;
  /** basename(rootPath) — cosmetic only; full rootPath belongs in a tooltip for disambiguation. */
  label: string;
  remotes: RemoteInfo[];
  branches: { name: string; sha: string }[];
  currentBranch: string | undefined;
}

const REFS_DEBOUNCE_MS = 400;

/** Sentinel distinguishing "we asked and there's genuinely no date" from "never asked" in the cache. */
const NO_DATE = Symbol('no-date');

interface RepoEntry {
  repository: Repository;
  watcher: vscode.Disposable | undefined;
  gitDirs: { gitDir: string; commonDir: string } | undefined;
  commitDateCache: Map<string, Date | typeof NO_DATE | Promise<Date | undefined>>;
  /** Keyed by [shaA,shaB].sort().join('|') — merge-base is symmetric for a two-ref lookup. */
  mergeBaseCache: Map<string, Promise<string | undefined>>;
}

function toHandle(repository: Repository): RepoHandle {
  const rootPath = repository.rootUri.fsPath;
  const branches = repository.state.refs
    .filter((r) => r.type === REF_TYPE_HEAD && r.name && r.commit)
    .map((r) => ({ name: r.name as string, sha: r.commit as string }));

  return {
    id: rootPath,
    rootPath,
    label: path.basename(rootPath),
    remotes: repository.state.remotes.map((r) => ({ name: r.name, fetchUrl: r.fetchUrl })),
    branches,
    currentBranch: repository.state.refs.find((r) => r.type === REF_TYPE_HEAD && r.commit)?.name,
  };
}

/**
 * Resolves a repo root's real git directory, handling worktrees/submodules
 * where ".git" is a file (containing "gitdir: <path>") rather than a
 * directory. Branch refs for a worktree live in the main repo's common dir,
 * not the worktree's own gitdir, so the two are reported separately.
 */
async function resolveGitDirs(
  rootPath: string
): Promise<{ gitDir: string; commonDir: string } | undefined> {
  const dotGit = path.join(rootPath, '.git');
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(vscode.Uri.file(dotGit));
  } catch {
    return undefined;
  }

  if (stat.type & vscode.FileType.Directory) {
    return { gitDir: dotGit, commonDir: dotGit };
  }

  if (stat.type & vscode.FileType.File) {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(dotGit))).toString(
        'utf8'
      );
    } catch {
      return undefined;
    }
    const match = text.match(/^gitdir:\s*(.+?)\s*$/m);
    if (!match) return undefined;
    const gitDir = path.isAbsolute(match[1]) ? match[1] : path.resolve(rootPath, match[1]);

    let commonDir = gitDir;
    try {
      const commonDirText = Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(gitDir, 'commondir')))
      )
        .toString('utf8')
        .trim();
      commonDir = path.isAbsolute(commonDirText)
        ? commonDirText
        : path.resolve(gitDir, commonDirText);
    } catch {
      // Not a worktree; no commondir file is expected and fine.
    }
    return { gitDir, commonDir };
  }

  return undefined;
}

/**
 * Watches a repo's HEAD and refs (including packed-refs, which `git
 * pack-refs` can rewrite without touching anything under refs/heads/) so
 * local branch changes refresh the tree without any network activity.
 * Debounced so a rebase's rapid-fire ref updates don't thrash the UI.
 */
function watchRepoRefs(
  gitDir: string,
  commonDir: string,
  onChanged: () => void
): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChanged, REFS_DEBOUNCE_MS);
  };

  const patterns = [
    new vscode.RelativePattern(vscode.Uri.file(gitDir), 'HEAD'),
    new vscode.RelativePattern(vscode.Uri.file(commonDir), 'refs/**'),
    new vscode.RelativePattern(vscode.Uri.file(commonDir), 'packed-refs'),
  ];
  const watchers = patterns.map((p) => vscode.workspace.createFileSystemWatcher(p));
  const subs = watchers.flatMap((w) => [
    w.onDidChange(debounced),
    w.onDidCreate(debounced),
    w.onDidDelete(debounced),
  ]);

  return vscode.Disposable.from(...watchers, ...subs, {
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  });
}

/**
 * Enumerates every open repo (multi-root aware) via the built-in vscode.git
 * extension, keeps that list live as repos open/close, and watches each
 * repo's local refs to signal structure changes without touching the network.
 */
export class RepoRegistry implements vscode.Disposable {
  private readonly entries = new Map<string, RepoEntry>();
  private readonly disposables: vscode.Disposable[] = [];

  private readonly _onDidChangeRepos = new vscode.EventEmitter<void>();
  readonly onDidChangeRepos = this._onDidChangeRepos.event;

  private readonly _onDidChangeRefs = new vscode.EventEmitter<string>();
  /** Fires with the repoId whose local refs changed (already debounced). */
  readonly onDidChangeRefs = this._onDidChangeRefs.event;

  private constructor() {}

  static async create(): Promise<RepoRegistry> {
    const registry = new RepoRegistry();
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) return registry;

    const exports = ext.isActive ? ext.exports : await ext.activate();
    const api = exports.getAPI(1);

    for (const repository of api.repositories) {
      await registry.addRepo(repository);
    }
    registry.disposables.push(
      api.onDidOpenRepository((repository) => {
        void registry.addRepo(repository).then(() => registry._onDidChangeRepos.fire());
      }),
      api.onDidCloseRepository((repository) => {
        registry.removeRepo(repository.rootUri.fsPath);
        registry._onDidChangeRepos.fire();
      })
    );
    return registry;
  }

  get repos(): RepoHandle[] {
    return [...this.entries.values()].map((e) => toHandle(e.repository));
  }

  /** Returns the cached commit date for a SHA, or undefined if unavailable. Never re-fetches an already-resolved SHA. */
  async getCommitDate(repoId: string, sha: string): Promise<Date | undefined> {
    const entry = this.entries.get(repoId);
    if (!entry) return undefined;

    const cached = entry.commitDateCache.get(sha);
    if (cached === NO_DATE) return undefined;
    if (cached instanceof Promise) return cached;
    if (cached) return cached;

    const pending = entry.repository.getCommit(sha).then(
      (commit) => {
        entry.commitDateCache.set(sha, commit.commitDate ?? NO_DATE);
        return commit.commitDate;
      },
      () => {
        entry.commitDateCache.delete(sha);
        return undefined;
      }
    );
    entry.commitDateCache.set(sha, pending);
    return pending;
  }

  /** Raw refs (local + remote-tracking + tags) for a repo, straight from state.refs. */
  getRefs(repoId: string): Ref[] | undefined {
    return this.entries.get(repoId)?.repository.state.refs;
  }

  /** Cached, never-throws merge-base lookup. undefined = indeterminate (matches the safety engine's 'unknown' semantics). */
  async getMergeBase(repoId: string, shaA: string, shaB: string): Promise<string | undefined> {
    const entry = this.entries.get(repoId);
    if (!entry) return undefined;

    const key = [shaA, shaB].sort().join('|');
    const cached = entry.mergeBaseCache.get(key);
    if (cached) return cached;

    const pending = entry.repository.getMergeBase(shaA, shaB).catch(() => undefined);
    entry.mergeBaseCache.set(key, pending);
    return pending;
  }

  /** Uncached — upstream state can change between calls (e.g. remote branch just deleted). Never throws. */
  async getBranchDetails(repoId: string, name: string): Promise<Branch | undefined> {
    const entry = this.entries.get(repoId);
    if (!entry) return undefined;
    try {
      return await entry.repository.getBranch(name);
    } catch {
      return undefined;
    }
  }

  /** Worktree-aware git/common dirs for a repo, or undefined if unresolved. Same resolution the ref watcher uses, exposed for direct ref file I/O (e.g. clean's backup mechanism) so callers never duplicate resolveGitDirs. */
  getGitDirs(repoId: string): { gitDir: string; commonDir: string } | undefined {
    return this.entries.get(repoId)?.gitDirs;
  }

  /** Creates a local branch. Rejects on failure (e.g. name collision) — callers must catch per-branch, unlike the informational lookups above which swallow errors. */
  async createBranch(repoId: string, name: string, checkout: boolean, ref?: string): Promise<void> {
    const entry = this.entries.get(repoId);
    if (!entry) throw new Error(`Unknown repo: ${repoId}`);
    await entry.repository.createBranch(name, checkout, ref);
  }

  /** Force-deletes a local branch (force: true === `git branch -D`). Rejects on failure — callers must catch per-branch. */
  async deleteBranch(repoId: string, name: string, force: boolean): Promise<void> {
    const entry = this.entries.get(repoId);
    if (!entry) throw new Error(`Unknown repo: ${repoId}`);
    await entry.repository.deleteBranch(name, force);
  }

  private async addRepo(repository: Repository): Promise<void> {
    const repoId = repository.rootUri.fsPath;
    let watcher: vscode.Disposable | undefined;
    let gitDirs: { gitDir: string; commonDir: string } | undefined;
    try {
      gitDirs = await resolveGitDirs(repoId);
      if (gitDirs) {
        watcher = watchRepoRefs(gitDirs.gitDir, gitDirs.commonDir, () =>
          this._onDidChangeRefs.fire(repoId)
        );
      }
    } catch {
      // Degrade gracefully: no auto-refresh for this repo, manual refresh still works.
      watcher = undefined;
      gitDirs = undefined;
    }

    this.entries.set(repoId, {
      repository,
      watcher,
      gitDirs,
      commitDateCache: new Map(),
      mergeBaseCache: new Map(),
    });
  }

  private removeRepo(repoId: string): void {
    this.entries.get(repoId)?.watcher?.dispose();
    this.entries.delete(repoId);
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.watcher?.dispose();
    this.entries.clear();
    for (const d of this.disposables) d.dispose();
    this._onDidChangeRepos.dispose();
    this._onDidChangeRefs.dispose();
  }
}
