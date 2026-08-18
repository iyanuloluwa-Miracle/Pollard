import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { SafetyAssessment } from '../safety';

export const PREVIEW_SCHEME = 'pollard-preview';

const previewContents = new Map<string, string>();

function setPreviewContent(id: string, content: string): void {
  previewContents.set(id, content);
}

export function clearPreviewContent(id: string): void {
  previewContents.delete(id);
}

function buildPreviewUri(id: string): vscode.Uri {
  return vscode.Uri.parse(`${PREVIEW_SCHEME}:/clean-preview?id=${id}`);
}

export class CleanPreviewContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const id = new URLSearchParams(uri.query).get('id');
    return (id && previewContents.get(id)) ?? '';
  }
}

/**
 * Register once at activation; the returned Disposable goes into
 * context.subscriptions. Virtual documents backed by a registered content
 * provider are automatically read-only in the editor — no extra work needed.
 */
export function registerCleanPreviewProvider(): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(
    PREVIEW_SCHEME,
    new CleanPreviewContentProvider()
  );
}

export interface PreviewEntry {
  repoLabel: string;
  branchName: string;
  sha: string;
  assessment: SafetyAssessment;
}

/**
 * Plain-text dry-run content. Short (7-char) SHAs are shown for readability;
 * a header note clarifies the full SHA is what's actually used internally
 * for backup/deletion.
 */
export function renderPreviewContent(entries: PreviewEntry[]): string {
  const repoLabel = entries[0]?.repoLabel ?? '';
  const lines: string[] = [
    `Pollard: Clean Preview — ${entries.length} branch(es) will be deleted in ${repoLabel}`,
    '(Short SHAs shown below; full SHAs are used internally for backup + deletion.)',
    '',
  ];
  for (const e of entries) {
    lines.push(e.branchName);
    lines.push(`  SHA:    ${e.sha.slice(0, 7)}`);
    lines.push(`  Status: ${e.assessment.status} (score ${e.assessment.score})`);
    lines.push('  Reasons:');
    for (const r of e.assessment.reasons) lines.push(`    - ${r}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Opens (and shows) the dry-run view for one clean-run session, keyed by id
 * so concurrent/sequential preview opens never collide. The caller clears
 * this id's content in a finally block once the run ends.
 */
export async function showCleanPreview(id: string, entries: PreviewEntry[]): Promise<void> {
  setPreviewContent(id, renderPreviewContent(entries));
  const doc = await vscode.workspace.openTextDocument(buildPreviewUri(id));
  await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
}

export function generatePreviewId(): string {
  return randomUUID();
}
