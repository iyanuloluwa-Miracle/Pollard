import * as path from 'path';
import * as vscode from 'vscode';
import { RepoRegistry } from '../git/repo-registry';

export interface BackupRef {
  branchName: string;
  sha: string;
  /** Full ref path, e.g. refs/pollard/backup/feature/foo/2026-08-17T14-32-01-123Z */
  refPath: string;
}

function backupRefFileUri(commonDir: string, refPath: string): vscode.Uri {
  return vscode.Uri.file(path.join(commonDir, ...refPath.split('/')));
}

/**
 * Writes a loose ref file directly under the repo's commonDir (shared across
 * worktrees) — not a branch or a tag. Lives entirely outside refs/heads/**,
 * so it never appears as a branch in RepoRegistry.repos[].branches or the
 * next scan, by construction — no filtering logic needs to know it exists.
 */
export async function createBackupRef(
  registry: RepoRegistry,
  repoId: string,
  branchName: string,
  sha: string
): Promise<BackupRef> {
  const dirs = registry.getGitDirs(repoId);
  if (!dirs) throw new Error(`Could not resolve git directory for repo: ${repoId}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const refPath = `refs/pollard/backup/${branchName}/${timestamp}`;
  const fileUri = backupRefFileUri(dirs.commonDir, refPath);

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fileUri.fsPath)));
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(`${sha}\n`, 'utf8'));

  return { branchName, sha, refPath };
}

async function readBackupRefSha(
  registry: RepoRegistry,
  repoId: string,
  refPath: string
): Promise<string | undefined> {
  const dirs = registry.getGitDirs(repoId);
  if (!dirs) return undefined;
  try {
    const content = Buffer.from(
      await vscode.workspace.fs.readFile(backupRefFileUri(dirs.commonDir, refPath))
    ).toString('utf8');
    return content.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Restores one branch from a backup ref written by createBackupRef. Reads
 * the ref back from disk (the durable source of truth) rather than trusting
 * delete-time in-memory state, so a manually-tampered or missing backup
 * surfaces as a real failure instead of silently restoring stale data.
 * Throws on a missing ref or on createBranch failure (e.g. name collision)
 * — callers catch per-branch.
 */
export async function restoreBranchFromBackup(
  registry: RepoRegistry,
  repoId: string,
  branchName: string,
  backupRefPath: string
): Promise<void> {
  const sha = await readBackupRefSha(registry, repoId, backupRefPath);
  if (!sha) throw new Error(`Backup ref not found or unreadable: ${backupRefPath}`);
  await registry.createBranch(repoId, branchName, false, sha);
}
