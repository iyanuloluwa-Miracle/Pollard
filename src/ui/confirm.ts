import * as vscode from 'vscode';
import { SafetyStatus } from '../safety';

export async function confirmDeletion(
  repoLabel: string,
  candidates: { branchName: string; status: SafetyStatus }[]
): Promise<boolean> {
  const countsByStatus = new Map<SafetyStatus, number>();
  for (const c of candidates) {
    countsByStatus.set(c.status, (countsByStatus.get(c.status) ?? 0) + 1);
  }
  const countsLines = [...countsByStatus.entries()].map(([s, n]) => `${s}: ${n}`).join('\n');

  // Literal string-prefix check — by construction this excludes UNKNOWN
  // (grouped into the tree's Warnings bucket, but its status string does
  // not start with "WARNING_"). Intentional literal reading of the task
  // text, not a bug.
  const warningCandidates = candidates.filter((c) => c.status.startsWith('WARNING_'));

  const detailParts = [countsLines];
  if (warningCandidates.length > 0) {
    detailParts.push(
      'The following branches have warnings:\n' +
        warningCandidates.map((c) => `  • ${c.branchName} (${c.status})`).join('\n')
    );
  }

  const choice = await vscode.window.showWarningMessage(
    `Delete ${candidates.length} branch(es) in ${repoLabel}?`,
    { modal: true, detail: detailParts.join('\n\n') },
    'Delete'
  );
  return choice === 'Delete';
}

/** Confirms restoring a backup under a renamed branch when the original name now collides with an existing branch — Pollard never overwrites an existing branch. */
export async function confirmRestoreAsRenamed(
  desiredName: string,
  candidate: string
): Promise<boolean> {
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
  return choice !== undefined;
}
