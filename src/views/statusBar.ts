import * as vscode from 'vscode';
import { RepoRegistry } from '../git/repo-registry';
import { RepoBucketCounts } from '../scan/assess';

/**
 * $(git-branch) N in the status bar, where N is deletion candidates only
 * (Safe + Squash-merged) summed across every open repo. Hidden when N is 0
 * or no repos are open. Clicking runs Pollard: Scan.
 */
export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly countsByRepo = new Map<string, RepoBucketCounts>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly registry: RepoRegistry) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    this.item.command = 'pollard.scan';
    this.disposables.push(
      this.item,
      registry.onDidChangeRepos(() => this.pruneClosedRepos())
    );
    this.render();
  }

  /** Called by scan/refresh right after branchTreeProvider.updateAssessments(repoId, ...). */
  setRepoCounts(repoId: string, counts: RepoBucketCounts): void {
    this.countsByRepo.set(repoId, counts);
    this.render();
  }

  clearRepoCounts(repoId: string): void {
    this.countsByRepo.delete(repoId);
    this.render();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private pruneClosedRepos(): void {
    const openIds = new Set(this.registry.repos.map((r) => r.id));
    for (const id of this.countsByRepo.keys()) {
      if (!openIds.has(id)) this.countsByRepo.delete(id);
    }
    this.render();
  }

  private render(): void {
    const entries = [...this.countsByRepo.values()];
    const total = entries.reduce((n, c) => n + c.safe + c.squashMerged, 0);
    if (total === 0 || this.registry.repos.length === 0) {
      this.item.hide();
      return;
    }
    this.item.text = `$(git-branch) ${total}`;
    this.item.tooltip = this.buildTooltip(entries);
    this.item.show();
  }

  private buildTooltip(entries: RepoBucketCounts[]): vscode.MarkdownString {
    const sum = entries.reduce(
      (a, c) => ({
        safe: a.safe + c.safe,
        squashMerged: a.squashMerged + c.squashMerged,
        warnings: a.warnings + c.warnings,
        protectedCount: a.protectedCount + c.protectedCount,
        unscanned: a.unscanned + c.unscanned,
      }),
      { safe: 0, squashMerged: 0, warnings: 0, protectedCount: 0, unscanned: 0 }
    );
    const md = new vscode.MarkdownString();
    md.appendMarkdown('**Pollard — deletion candidates**\n\n');
    const rows: [string, number][] = [
      ['Safe', sum.safe],
      ['Squash-merged', sum.squashMerged],
      ['Warnings', sum.warnings],
      ['Protected', sum.protectedCount],
      ['Not yet assessed', sum.unscanned],
    ];
    for (const [label, count] of rows) {
      if (count > 0) md.appendMarkdown(`- ${label}: ${count}\n`);
    }
    md.appendMarkdown('\n_Click to re-scan._');
    return md;
  }
}
