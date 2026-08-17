import * as vscode from 'vscode';
import { GitExtension } from './git-api-types';

/** vscode.git's RefType.Head — see git-api-types.d.ts. */
const REF_TYPE_HEAD = 0;

export interface RemoteInfo {
  name: string;
  fetchUrl: string | undefined;
}

export interface RepoInfo {
  rootPath: string;
  remotes: RemoteInfo[];
  /** Local branch short names, e.g. "feature/x" (no "refs/heads/" prefix). */
  branches: string[];
}

/**
 * Discovers the active workspace repo's remotes and local branches via the
 * built-in `vscode.git` extension. Returns undefined if that extension isn't
 * installed/active or has no open repositories — callers should treat that
 * as "no recognised remote" and fall back to a NoopProvider.
 */
export async function getActiveRepoInfo(): Promise<RepoInfo | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return undefined;

  const exports = ext.isActive ? ext.exports : await ext.activate();
  const api = exports.getAPI(1);
  const repo = api.repositories[0];
  if (!repo) return undefined;

  return {
    rootPath: repo.rootUri.fsPath,
    remotes: repo.state.remotes.map((r) => ({ name: r.name, fetchUrl: r.fetchUrl })),
    branches: repo.state.refs
      .filter((r) => r.type === REF_TYPE_HEAD && r.name)
      .map((r) => r.name as string),
  };
}
