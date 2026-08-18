import * as vscode from 'vscode';
import { writeBackupRef, restoreBranchFromBackup } from '../git';
import { getMinimumScoreForBulkDelete } from '../config';
import { classifyError, logAndTrackError, PollardCommandId } from '../errors';
import { PollardLogger } from '../logger';
import { pickRepo } from '../ui';
import { confirmDeletion } from '../ui';
import { RepoHandle } from '../workspace';
import { tallyBucketCounts } from '../safety';
import { statusIconAndColor } from '../safety';
import { BranchAssessment, SafetyStatus } from '../safety';
import { ScanDeps } from './types';
import { BranchTreeElement } from '../views';
import { PreviewEntry, clearPreviewContent, generatePreviewId, showCleanPreview } from '../views';

export type CleanDeps = ScanDeps;

interface CleanCandidate {
  repoId: string;
  branchName: string;
  sha: string;
  branchAssessment: BranchAssessment;
}

/** Statuses eligible for deletion. Must be kept in sync with the view/item/context `when` regex in package.json — a when-clause can't import a TS constant. */
const DELETABLE_STATUSES: ReadonlySet<SafetyStatus> = new Set([
  'SAFE_MERGED',
  'SAFE_SQUASH_MERGED',
  'WARNING_CLOSED_PR',
  'WARNING_UNMERGED',
  'WARNING_NO_PR',
  'UNKNOWN',
]);

type DeleteOutcome =
  | { kind: 'deleted'; backupRefPath: string }
  | { kind: 'backupFailed'; error: string }
  | { kind: 'deleteFailed'; backupRefPath: string; error: string };

interface BranchDeleteResult {
  repoId: string;
  branchName: string;
  sha: string;
  outcome: DeleteOutcome;
}

interface BranchRestoreResult {
  repoId: string;
  branchName: string;
  ok: boolean;
  error?: string;
}

function isDeleted(
  r: BranchDeleteResult
): r is BranchDeleteResult & { outcome: { kind: 'deleted'; backupRefPath: string } } {
  return r.outcome.kind === 'deleted';
}

function buildEligibleCandidates(
  repo: RepoHandle,
  assessments: Map<string, BranchAssessment> | undefined
): CleanCandidate[] {
  if (!assessments) return [];
  const out: CleanCandidate[] = [];
  for (const b of repo.branches) {
    const a = assessments.get(b.name);
    if (a && DELETABLE_STATUSES.has(a.assessment.status)) {
      out.push({ repoId: repo.id, branchName: b.name, sha: b.sha, branchAssessment: a });
    }
  }
  return out;
}

interface CleanQuickPickItem extends vscode.QuickPickItem {
  candidate: CleanCandidate;
}

function buildQuickPickItems(
  candidates: CleanCandidate[],
  minimumScoreForBulkDelete: number
): CleanQuickPickItem[] {
  const sorted = [...candidates].sort(
    (a, b) =>
      b.branchAssessment.assessment.score - a.branchAssessment.assessment.score ||
      a.branchName.localeCompare(b.branchName)
  );
  return sorted.map((c) => {
    const { status, score, reasons } = c.branchAssessment.assessment;
    const { icon, color } = statusIconAndColor(status);
    return {
      label: c.branchName,
      description: `${status} · score ${score}`,
      detail: reasons.join(' • '),
      picked: score >= minimumScoreForBulkDelete,
      iconPath: new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined),
      candidate: c,
    };
  });
}

function buildPreviewEntries(repo: RepoHandle, candidates: CleanCandidate[]): PreviewEntry[] {
  return candidates.map((c) => ({
    repoLabel: repo.label,
    branchName: c.branchName,
    sha: c.sha,
    assessment: c.branchAssessment.assessment,
  }));
}

async function deleteWithBackup(
  deps: CleanDeps,
  repoId: string,
  branchName: string,
  fallbackSha: string,
  command: PollardCommandId
): Promise<BranchDeleteResult> {
  const errCtx = { logChannel: deps.logChannel, telemetry: deps.telemetry, command };

  // Re-resolve the current tip immediately before backing up — the branch
  // may have moved since the QuickPick/preview snapshot; the backup must
  // protect the SHA actually about to be deleted, not a stale one.
  const current = await deps.registry.getBranchDetails(repoId, branchName);
  const sha = current?.commit ?? fallbackSha;

  let backupRefPath: string;
  try {
    ({ refPath: backupRefPath } = await writeBackupRef(deps.registry, repoId, branchName, sha));
  } catch (err) {
    // Fail-safe: never delete without a safety net.
    const classified = classifyError(err);
    logAndTrackError(classified, errCtx);
    return {
      repoId,
      branchName,
      sha,
      outcome: { kind: 'backupFailed', error: classified.message },
    };
  }

  try {
    await deps.registry.deleteBranch(repoId, branchName, true);
    return { repoId, branchName, sha, outcome: { kind: 'deleted', backupRefPath } };
  } catch (err) {
    const classified = classifyError(err);
    logAndTrackError(classified, errCtx);
    return {
      repoId,
      branchName,
      sha,
      outcome: { kind: 'deleteFailed', backupRefPath, error: classified.message },
    };
  }
}

function recomputeStatusBar(deps: CleanDeps, repoId: string): void {
  const assessments = deps.branchTreeProvider.getAssessments(repoId);
  if (assessments) deps.statusBar.setRepoCounts(repoId, tallyBucketCounts(assessments));
  else deps.statusBar.clearRepoCounts(repoId);
}

function writeDeleteResultsToLog(
  channel: PollardLogger,
  repo: RepoHandle,
  results: BranchDeleteResult[]
): void {
  channel.appendLine(`[${new Date().toISOString()}] Clean run — ${repo.label} (${repo.rootPath})`);
  for (const r of results) {
    channel.appendLine(`  ${r.branchName}`);
    channel.appendLine(`    SHA: ${r.sha}`);
    if (r.outcome.kind === 'deleted') {
      channel.appendLine(`    Backup ref: ${r.outcome.backupRefPath}`);
      channel.appendLine('    Delete: OK');
    } else if (r.outcome.kind === 'backupFailed') {
      channel.appendLine(`    Backup: FAILED — ${r.outcome.error}`);
      channel.appendLine('    Delete: SKIPPED (no backup was created)');
    } else {
      channel.appendLine(`    Backup ref: ${r.outcome.backupRefPath}`);
      channel.appendLine(`    Delete: FAILED — ${r.outcome.error}`);
    }
  }
  channel.appendLine('');
}

function writeRestoreResultsToLog(
  channel: PollardLogger,
  results: BranchRestoreResult[]
): void {
  channel.appendLine(`[${new Date().toISOString()}] Restore run`);
  for (const r of results) {
    channel.appendLine(`  ${r.branchName}: ${r.ok ? 'OK' : `FAILED — ${r.error}`}`);
  }
  channel.appendLine('');
}

async function restoreDeleted(
  deps: CleanDeps,
  repoId: string,
  succeeded: (BranchDeleteResult & { outcome: { kind: 'deleted'; backupRefPath: string } })[],
  originalAssessments: Map<string, BranchAssessment>,
  command: PollardCommandId
): Promise<void> {
  const errCtx = { logChannel: deps.logChannel, telemetry: deps.telemetry, command };
  const results: BranchRestoreResult[] = [];
  for (const r of succeeded) {
    try {
      await restoreBranchFromBackup(deps.registry, repoId, r.branchName, r.outcome.backupRefPath);
      const original = originalAssessments.get(r.branchName);
      if (original) deps.branchTreeProvider.setAssessment(repoId, r.branchName, original);
      results.push({ repoId, branchName: r.branchName, ok: true });
    } catch (err) {
      const classified = classifyError(err);
      logAndTrackError(classified, errCtx);
      results.push({ repoId, branchName: r.branchName, ok: false, error: classified.message });
    }
  }
  recomputeStatusBar(deps, repoId);
  writeRestoreResultsToLog(deps.logChannel, results);

  const failed = results.filter((r) => !r.ok).length;
  const summary = `Pollard: Restored ${results.length - failed}/${results.length} branch(es).`;
  if (failed > 0) {
    const choice = await vscode.window.showWarningMessage(
      `${summary} ${failed} failed.`,
      'Show Log'
    );
    if (choice === 'Show Log') deps.logChannel.show();
  } else {
    void vscode.window.showInformationMessage(summary);
  }
}

async function showCleanResult(
  deps: CleanDeps,
  repo: RepoHandle,
  candidates: CleanCandidate[],
  results: BranchDeleteResult[],
  command: PollardCommandId
): Promise<void> {
  writeDeleteResultsToLog(deps.logChannel, repo, results);

  const succeeded = results.filter(isDeleted);
  const failed = results.length - succeeded.length;
  const summary =
    `Pollard: Deleted ${succeeded.length}/${results.length} branch(es) in ${repo.label}` +
    (failed ? ` — ${failed} failed.` : '.');

  const buttons = succeeded.length > 0 ? ['Restore', 'Show Log'] : ['Show Log'];
  const choice =
    failed > 0
      ? await vscode.window.showWarningMessage(summary, ...buttons)
      : await vscode.window.showInformationMessage(summary, ...buttons);

  if (choice === 'Show Log') {
    deps.logChannel.show();
  } else if (choice === 'Restore') {
    const originalByName = new Map(candidates.map((c) => [c.branchName, c.branchAssessment]));
    await restoreDeleted(deps, repo.id, succeeded, originalByName, command);
  }
}

/**
 * The single shared implementation of steps 2-5. Both entry points below
 * terminate here and nowhere else reimplements this flow, so "the inline
 * trash icon routes through the same confirm path" holds by construction:
 * each step's function signature requires the previous step's output as its
 * only input, so there is no path that can reach step N without having
 * produced step N-1's result first.
 */
async function runCleanFlow(
  deps: CleanDeps,
  repo: RepoHandle,
  candidates: CleanCandidate[],
  command: PollardCommandId
): Promise<void> {
  if (candidates.length === 0) return;

  const previewId = generatePreviewId();
  try {
    // STEP 2 — preview (dry run).
    await showCleanPreview(previewId, buildPreviewEntries(repo, candidates));

    // STEP 3 — confirm.
    const confirmed = await confirmDeletion(
      repo.label,
      candidates.map((c) => ({ branchName: c.branchName, status: c.branchAssessment.assessment.status }))
    );
    if (!confirmed) return;

    // STEP 4 — backup-then-delete, sequential per branch. Cancellable: a
    // large confirmed batch can be stopped partway through.
    const results: BranchDeleteResult[] = [];
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Pollard: Deleting branches in ${repo.label}`,
        cancellable: true,
      },
      async (progress, token) => {
        const increment = 100 / candidates.length;
        for (const c of candidates) {
          if (token.isCancellationRequested) break;
          results.push(await deleteWithBackup(deps, repo.id, c.branchName, c.sha, command));
          progress.report({ increment, message: c.branchName });
        }
      }
    );
    for (const r of results) {
      if (isDeleted(r)) deps.branchTreeProvider.setAssessment(r.repoId, r.branchName, undefined);
    }
    recomputeStatusBar(deps, repo.id);

    // STEP 5 — result notification.
    await showCleanResult(deps, repo, candidates, results, command);
  } finally {
    clearPreviewContent(previewId);
  }
}

/** Entry point 1: Command Palette / toolbar. Repo-picks (if needed), then the multi-select QuickPick, then runCleanFlow. */
export async function runClean(deps: CleanDeps): Promise<void> {
  const command: PollardCommandId = 'pollard.clean';
  const repo = await pickRepo(deps.registry, 'Pollard: Clean — choose a repository', {
    logChannel: deps.logChannel,
    telemetry: deps.telemetry,
    command,
  });
  if (!repo) return;

  const assessments = deps.branchTreeProvider.getAssessments(repo.id);
  if (!assessments) {
    void vscode.window.showInformationMessage('Pollard: Run Pollard: Scan first.');
    return;
  }

  const candidates = buildEligibleCandidates(repo, assessments);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('Pollard: No deletable branches found.');
    return;
  }

  const items = buildQuickPickItems(candidates, getMinimumScoreForBulkDelete());
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    title: `Pollard: Clean — ${repo.label}`,
    placeHolder: 'Space to toggle selection, Enter to continue to preview',
  });
  if (!picked) return;
  if (picked.length === 0) {
    void vscode.window.showInformationMessage('Pollard: No branches selected.');
    return;
  }

  await runCleanFlow(
    deps,
    repo,
    picked.map((i) => i.candidate),
    command
  );
}

/** Entry point 2: the inline trash icon. Skips step 1 entirely — the tree element already identifies exactly one branch. */
export async function runCleanSingleBranch(
  deps: CleanDeps,
  element: Extract<BranchTreeElement, { kind: 'branch' }>
): Promise<void> {
  await deps.registry.whenReady();
  const repo = deps.registry.repos.find((r) => r.id === element.repoId);
  if (!repo) return;
  const branchAssessment = deps.branchTreeProvider
    .getAssessments(element.repoId)
    ?.get(element.branchName);
  if (!branchAssessment) return; // shouldn't happen: the menu's when-clause already restricts to deletable statuses

  await runCleanFlow(
    deps,
    repo,
    [
      {
        repoId: element.repoId,
        branchName: element.branchName,
        sha: element.sha,
        branchAssessment,
      },
    ],
    'pollard.deleteBranch'
  );
}
