import * as vscode from 'vscode';
import { CleanDeps } from '../clean/clean';
import { getBackupsRetentionDays } from '../config';
import { RepoHandle } from '../git/repo-registry';
import { BackupRefEntry, deleteBackupRef, listBackupRefs } from './backupRefs';

interface PruneResult {
  repoId: string;
  refPath: string;
  ok: boolean;
  error?: string;
}

function writePruneResultsToLog(channel: vscode.OutputChannel, results: PruneResult[]): void {
  channel.appendLine(`[${new Date().toISOString()}] Prune backups run`);
  for (const r of results) {
    channel.appendLine(`  ${r.refPath}: ${r.ok ? 'OK' : `FAILED — ${r.error}`}`);
  }
  channel.appendLine('');
}

/**
 * Entry point for pollard.pruneBackups. Sweeps every open repo (an age-based
 * cleanup needs no per-branch human selection, unlike restore) and deletes
 * backup refs older than pollard.backups.retentionDays. Only ever runs when
 * this command is explicitly invoked — nothing in the extension calls this
 * automatically.
 */
export async function runPruneBackups(deps: CleanDeps): Promise<void> {
  const retentionDays = getBackupsRetentionDays();
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const repos = deps.registry.repos;
  const perRepo: { repo: RepoHandle; stale: BackupRefEntry[] }[] = [];
  for (const repo of repos) {
    const stale = (await listBackupRefs(deps.registry, repo.id)).filter(
      (e) => e.timestampMs < cutoffMs
    );
    if (stale.length > 0) perRepo.push({ repo, stale });
  }

  const total = perRepo.reduce((n, r) => n + r.stale.length, 0);
  if (total === 0) {
    vscode.window.showInformationMessage(
      `Pollard: No backups older than ${retentionDays} day(s) found.`
    );
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Permanently delete ${total} backup ref(s) older than ${retentionDays} day(s)?`,
    {
      modal: true,
      detail:
        perRepo.map((r) => `${r.repo.label}: ${r.stale.length}`).join('\n') +
        '\n\nThis cannot be undone — these branches will no longer be recoverable via Pollard: Restore.',
    },
    'Delete'
  );
  if (choice !== 'Delete') return;

  const results: PruneResult[] = [];
  for (const { repo, stale } of perRepo) {
    for (const entry of stale) {
      try {
        await deleteBackupRef(deps.registry, repo.id, entry);
        results.push({ repoId: repo.id, refPath: entry.refPath, ok: true });
      } catch (err) {
        results.push({ repoId: repo.id, refPath: entry.refPath, ok: false, error: String(err) });
      }
    }
  }

  writePruneResultsToLog(deps.cleanLogChannel, results);
  const failed = results.filter((r) => !r.ok).length;
  const summary = `Pollard: Pruned ${results.length - failed}/${results.length} backup ref(s).`;
  if (failed > 0) {
    const c = await vscode.window.showWarningMessage(`${summary} ${failed} failed.`, 'Show Log');
    if (c === 'Show Log') deps.cleanLogChannel.show();
  } else {
    vscode.window.showInformationMessage(summary);
  }
}
