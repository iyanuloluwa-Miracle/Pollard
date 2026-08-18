import { PullRequestInfo } from '../providers';

const CURRENT_SCHEMA_VERSION = 1;

export interface CachedPullRequestEntry {
  fetchedAt: number;
  pullRequests: PullRequestInfo[];
}

export interface CacheFileV1 {
  schemaVersion: 1;
  pullRequestsByBranch: Record<string, CachedPullRequestEntry>;
}

export type CacheFile = CacheFileV1;

export function emptyCacheFile(): CacheFile {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, pullRequestsByBranch: {} };
}

/**
 * Upgrades older schema versions to the current shape, or returns undefined
 * if there's no migration path — callers should discard and start fresh
 * rather than trust unrecognised or corrupt data. No prior versions exist
 * yet; when CacheFileV2 is introduced, add a migrateV1ToV2 step here and
 * chain it before the final version check.
 */
export function migrate(raw: unknown): CacheFile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === CURRENT_SCHEMA_VERSION) return raw as CacheFile;
  return undefined;
}
