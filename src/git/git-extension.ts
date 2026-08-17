import * as vscode from 'vscode';
import { GitExtension } from './git-api-types';
import { ParsedRemote, parseGitRemoteUrl } from './remote-url';

/** vscode.git's RefType — see git-api-types.d.ts. */
export const REF_TYPE_HEAD = 0;
export const REF_TYPE_REMOTE_HEAD = 1;

export interface RemoteInfo {
  name: string;
  fetchUrl: string | undefined;
}

/** 'origin' if present, else the first remote, else undefined. */
export function pickPrimaryRemoteName(remotes: RemoteInfo[]): string | undefined {
  return remotes.some((r) => r.name === 'origin') ? 'origin' : remotes[0]?.name;
}

/** Raw fetchUrl of the primary remote — used verbatim as RepoCache's cache-key input. */
export function primaryRemoteFetchUrl(remotes: RemoteInfo[]): string | undefined {
  const primaryName = pickPrimaryRemoteName(remotes);
  return remotes.find((r) => r.name === primaryName)?.fetchUrl;
}

/** Parsed primary remote for provider construction; falls back to any other remote that parses. */
export function resolvePrimaryParsedRemote(remotes: RemoteInfo[]): ParsedRemote | undefined {
  const primary = primaryRemoteFetchUrl(remotes);
  const parsed = primary ? parseGitRemoteUrl(primary) : undefined;
  if (parsed) return parsed;

  for (const r of remotes) {
    const p = r.fetchUrl ? parseGitRemoteUrl(r.fetchUrl) : undefined;
    if (p) return p;
  }
  return undefined;
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
