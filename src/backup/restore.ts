import * as vscode from 'vscode';
import { CleanDeps } from '../clean/clean';
import { classifyError, logAndTrackError } from '../errors';
import { RepoHandle } from '../git/repo-registry';
import { pickRepo } from '../git/pickRepo';
import { BackupRefEntry, listBackupRefs, restoreBranchFromBackup } from './backupRefs';

function formatDeletionTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface RestoreQuickPickItem extends vscode.QuickPickItem {
  entry: BackupRefEntry;
}

function buildQuickPickItems(entries: BackupRefEntry[]): RestoreQuickPickItem[] {
  return [...entries]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .map((e) => ({
      label: e.branchName,
      description: `${e.sha.slice(0, 7)} · deleted ${formatDeletionTime(e.timestampMs)}`,
      detail: e.subject || '(no commit message)',
      entry: e,
    }));
}

/**
 * If desiredName collides with an existing branch, finds the smallest N such
 * that "<desiredName>-restored-N" is free, confirms with the user (offering
 * ONLY that renamed path — Pollard never overwrites an existing branch),
 * and returns the name to actually restore under. Returns undefined if the
 * user cancels.
 */
async function resolveRestoreName(
  repo: RepoHandle,
  desiredName: string
): Promise<string | undefined> {
  const existingNames = new Set(repo.branches.map((b) => b.name));
  if (!existingNames.has(desiredName)) return desiredName;

  let n = 1;
  let candidate = `${desiredName}-restored-${n}`;
  while (existingNames.has(candidate)) {
    n += 1;
    candidate = `${desiredName}-restored-${n}`;
  }

  const choice = await vscode.window.showWarningMessage(
    `Pollard: A branch named "${desiredName}" already exists.`,
    {
      modal: true,
      detail:
        `Restoring this backup would collide with the existing branch. ` +
        `Pollard never overwrites an existing branch.\n\nRestore as "${candidate}" instead?`,
    },
    `Restore as "${candidate}"`
  );
  return choice ? candidate : undefined;
}

/** Entry point for pollard.restore: repo-picks, browses that repo's backup refs via for-each-ref, and recreates the chosen one. */
export async function runRestore(deps: CleanDeps): Promise<void> {
  const errCtx = {
    logChannel: deps.logChannel,
    telemetry: deps.telemetry,
    command: 'pollard.restore' as const,
  };

  const repo = await pickRepo(deps.registry, 'Pollard: Restore — choose a repository', errCtx);
  if (!repo) return;

  const entries = await listBackupRefs(deps.registry, repo.id, deps.logChannel);
  if (entries.length === 0) {
    vscode.window.showInformationMessage(`Pollard: No backups found for ${repo.label}.`);
    return;
  }

  const picked = await vscode.window.showQuickPick(buildQuickPickItems(entries), {
    title: `Pollard: Restore — ${repo.label}`,
    placeHolder: 'Select a deleted branch to restore',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;

  const finalName = await resolveRestoreName(repo, picked.entry.branchName);
  if (!finalName) return;

  deps.logChannel.appendLine(
    `[${new Date().toISOString()}] Restore — ${repo.label}: ${picked.entry.branchName} -> ${finalName} (${picked.entry.refPath})`
  );

  try {
    await restoreBranchFromBackup(deps.registry, repo.id, finalName, picked.entry.refPath);
    vscode.window.showInformationMessage(`Pollard: Restored "${finalName}".`);
  } catch (err) {
    const classified = classifyError(err);
    logAndTrackError(classified, errCtx);
    deps.logChannel.appendLine(`  FAILED — ${classified.message}`);
    const choice = await vscode.window.showErrorMessage(
      `Pollard: Failed to restore "${finalName}".`,
      'Show Log'
    );
    if (choice === 'Show Log') deps.logChannel.show();
  }
}
