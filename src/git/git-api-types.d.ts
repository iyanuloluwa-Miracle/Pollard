/**
 * Trimmed subset of the official `vscode.git` extension's exported API
 * (https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts).
 * Not published to npm — the extension exposes these types only via its
 * runtime exports, so the slice actually used here is vendored by hand.
 */

import type { Event } from 'vscode';

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface Ref {
  /** 0 = Head, 1 = RemoteHead, 2 = Tag — see REF_TYPE_HEAD in git-extension.ts. */
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface RepositoryState {
  readonly remotes: Remote[];
  readonly refs: Ref[];
}

export interface Commit {
  readonly hash: string;
  readonly commitDate?: Date;
}

export interface UpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

export interface Branch extends Ref {
  readonly upstream?: UpstreamRef;
}

export interface Repository {
  readonly rootUri: { readonly fsPath: string };
  readonly state: RepositoryState;
  getCommit(ref: string): Promise<Commit>;
  getBranch(name: string): Promise<Branch>;
  /** Rejects if no common ancestor exists (e.g. shallow clone) — always wrap in try/catch, never null-check. */
  getMergeBase(ref1: string, ref2: string): Promise<string>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  /** force: true === `git branch -D`. */
  deleteBranch(name: string, force?: boolean): Promise<void>;
}

/** Exposes the resolved git executable the built-in extension itself launched with. */
export interface Git {
  readonly path: string;
}

export interface API {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  readonly git: Git;
}

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}
