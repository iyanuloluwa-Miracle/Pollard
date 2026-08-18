import { PollardLogger } from '../logger';
import { runGit } from './exec';
import { RepoRegistry } from '../workspace/repositories';

export const BACKUP_REF_PREFIX = 'refs/pollard/backups/';

export interface BackupRef {
  branchName: string;
  sha: string;
  /** Full ref path, e.g. refs/pollard/backups/feature/foo/1755436321 */
  refPath: string;
}

export interface BackupRefEntry extends BackupRef {
  timestampMs: number;
  subject: string;
}

function parseBackupRefLine(line: string): BackupRefEntry | undefined {
  const [refPath, sha, subject = ''] = line.split('\x1f');
  if (!refPath?.startsWith(BACKUP_REF_PREFIX) || !sha) return undefined;
  const rest = refPath.slice(BACKUP_REF_PREFIX.length); // "<branchName>/<unixTimestamp>"
  const lastSlash = rest.lastIndexOf('/');
  if (lastSlash === -1) return undefined;
  const branchName = rest.slice(0, lastSlash);
  const tsSegment = rest.slice(lastSlash + 1);
  if (!/^\d+$/.test(tsSegment)) return undefined;
  return { refPath, branchName, sha, subject, timestampMs: Number(tsSegment) * 1000 };
}

/**
 * Writes refs/pollard/backups/<branchName>/<unixSeconds> with a real reflog
 * entry via `git update-ref`. Note: update-ref does NOT create a reflog for
 * refs outside refs/heads/, refs/remotes/, or HEAD unless told to — without
 * --create-reflog this would silently write the ref with no reflog at all.
 */
export async function writeBackupRef(
  registry: RepoRegistry,
  repoId: string,
  branchName: string,
  sha: string
): Promise<BackupRef> {
  const dirs = registry.getGitDirs(repoId);
  if (!dirs) throw new Error(`Could not resolve git directory for repo: ${repoId}`);

  const unixSeconds = Math.floor(Date.now() / 1000);
  const refPath = `${BACKUP_REF_PREFIX}${branchName}/${unixSeconds}`;
  await runGit(registry.getGitPath(), dirs.commonDir, [
    'update-ref',
    '--create-reflog',
    '-m',
    `pollard: backup before deleting ${branchName}`,
    refPath,
    sha,
  ]);
  return { branchName, sha, refPath };
}

/** Every backup ref for a repo. Never throws — returns []. */
export async function listBackupRefs(
  registry: RepoRegistry,
  repoId: string,
  logChannel?: PollardLogger
): Promise<BackupRefEntry[]> {
  const dirs = registry.getGitDirs(repoId);
  if (!dirs) return [];
  try {
    const { stdout } = await runGit(registry.getGitPath(), dirs.commonDir, [
      'for-each-ref',
      '--format=%(refname)%x1f%(objectname)%x1f%(subject)',
      BACKUP_REF_PREFIX,
    ]);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(parseBackupRefLine)
      .filter((e): e is BackupRefEntry => e !== undefined);
  } catch (err) {
    logChannel?.trace(`listBackupRefs failed for ${repoId}: ${String(err)}`);
    return [];
  }
}

async function getBackupRefSha(
  registry: RepoRegistry,
  repoId: string,
  refPath: string,
  logChannel?: PollardLogger
): Promise<string | undefined> {
  const dirs = registry.getGitDirs(repoId);
  if (!dirs) return undefined;
  try {
    const { stdout } = await runGit(registry.getGitPath(), dirs.commonDir, [
      'for-each-ref',
      '--format=%(objectname)',
      refPath,
    ]);
    return stdout.trim() || undefined;
  } catch (err) {
    logChannel?.trace(`getBackupRefSha failed for ${refPath}: ${String(err)}`);
    return undefined;
  }
}

/**
 * Restores one branch from a backup ref, re-reading the SHA from disk (the
 * durable source of truth) rather than trusting delete-time in-memory state.
 * Throws on a missing ref or on createBranch failure (e.g. name collision)
 * — callers catch per-branch.
 */
export async function restoreBranchFromBackup(
  registry: RepoRegistry,
  repoId: string,
  branchName: string,
  backupRefPath: string
): Promise<void> {
  const sha = await getBackupRefSha(registry, repoId, backupRefPath);
  if (!sha) throw new Error(`Backup ref not found or unreadable: ${backupRefPath}`);
  await registry.createBranch(repoId, branchName, false, sha);
}

/** Deletes one backup ref, passing the known SHA as an old-value safety check (fails safely if something else changed it concurrently). */
export async function deleteBackupRef(
  registry: RepoRegistry,
  repoId: string,
  entry: Pick<BackupRefEntry, 'refPath' | 'sha'>
): Promise<void> {
  const dirs = registry.getGitDirs(repoId);
  if (!dirs) throw new Error(`Could not resolve git directory for repo: ${repoId}`);
  await runGit(registry.getGitPath(), dirs.commonDir, [
    'update-ref',
    '-d',
    entry.refPath,
    entry.sha,
  ]);
}
