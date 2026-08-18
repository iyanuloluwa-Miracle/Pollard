import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { getCacheTtlMinutes } from '../config';
import { PollardLogger } from '../logger';
import { PullRequestInfo } from '../providers';
import { CachedPullRequestEntry, CacheFile, emptyCacheFile, migrate } from './schema';

/**
 * Persists per-repo PR lookup results (only — never tokens/sessions/PATs,
 * those belong in vscode.authentication/SecretStorage) as one JSON file per
 * repo under context.globalStorageUri, so a "refresh" can read cached PR
 * state for free and only a "scan" needs to hit the network.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const CACHE_SUBDIR = 'cache';

/** Hashes repo path + remote URL into a stable, filesystem-safe cache key. */
export function computeRepoKey(repoPath: string, remoteUrl: string | undefined): string {
  return createHash('sha256')
    .update(`${repoPath} ${remoteUrl ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

function isExpired(entry: CachedPullRequestEntry, ttlMs: number, now: number): boolean {
  return now - entry.fetchedAt > ttlMs;
}

function getConfiguredTtlMs(): number {
  const minutes = getCacheTtlMinutes();
  return minutes > 0 ? minutes * 60_000 : DEFAULT_TTL_MS;
}

/** Per-repo cache of PR lookup results, backed by a JSON file under globalStorageUri. */
export class RepoCache {
  private readonly fileUri: vscode.Uri;
  private readonly ttlMs: number;

  constructor(
    private readonly context: vscode.ExtensionContext,
    repoPath: string,
    remoteUrl: string | undefined,
    ttlMs?: number,
    private readonly logChannel?: PollardLogger
  ) {
    const key = computeRepoKey(repoPath, remoteUrl);
    this.fileUri = vscode.Uri.joinPath(context.globalStorageUri, CACHE_SUBDIR, `${key}.json`);
    this.ttlMs = ttlMs ?? getConfiguredTtlMs();
  }

  /** Filesystem path of this repo's cache file. Used by pollard.doctor. */
  getFilePath(): string {
    return this.fileUri.fsPath;
  }

  /** Returns cached PR results for a branch, or undefined if missing/expired. Never touches the network. */
  async getPullRequests(branch: string): Promise<PullRequestInfo[] | undefined> {
    const data = await this.read();
    const entry = data.pullRequestsByBranch[branch];
    if (!entry || isExpired(entry, this.ttlMs, Date.now())) return undefined;
    return entry.pullRequests;
  }

  /** Persists PR results for many branches in one write, matching the providers' batched lookups. */
  async setPullRequests(results: Map<string, PullRequestInfo[]>): Promise<void> {
    const data = await this.read();
    const fetchedAt = Date.now();
    for (const [branch, pullRequests] of results) {
      data.pullRequestsByBranch[branch] = { fetchedAt, pullRequests };
    }
    await this.write(data);
  }

  /** Max fetchedAt across every cached branch entry, or undefined if the cache is empty/unreadable — used by pollard.doctor as a "last scan" proxy since no dedicated timestamp field exists. */
  async getLastFetchedAt(): Promise<number | undefined> {
    const data = await this.read();
    const timestamps = Object.values(data.pullRequestsByBranch).map((e) => e.fetchedAt);
    return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  }

  private async read(): Promise<CacheFile> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri);
      const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
      return migrate(parsed) ?? emptyCacheFile();
    } catch (err) {
      this.logChannel?.trace(
        `RepoCache: no cache file or unreadable at ${this.fileUri.fsPath}: ${String(err)}`
      );
      return emptyCacheFile();
    }
  }

  private async write(data: CacheFile): Promise<void> {
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, CACHE_SUBDIR);
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(this.fileUri, Buffer.from(JSON.stringify(data), 'utf8'));
  }
}

/** Deletes all cached scan results for every repo. Backs the "Pollard: Clear Cache" command. */
export async function clearCache(context: vscode.ExtensionContext): Promise<void> {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, CACHE_SUBDIR);
  try {
    await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
  } catch {
    // Nothing to clear.
  }
}
