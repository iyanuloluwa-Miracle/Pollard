import * as vscode from 'vscode';
import { RepoRegistry } from '../git/repo-registry';
import { PullRequestInfo } from '../providers/types';
import { SafetyAssessment, SafetyStatus } from '../safety/engine';

export interface BranchAssessment {
  assessment: SafetyAssessment;
  pullRequest: PullRequestInfo | null;
}

export type BucketKind = 'safe' | 'squashMerged' | 'warnings' | 'protected' | 'unscanned';

export type BranchTreeElement =
  | { kind: 'repo'; id: string; repoId: string }
  | { kind: 'bucket'; id: string; repoId: string; bucket: BucketKind }
  | { kind: 'branch'; id: string; repoId: string; branchName: string; sha: string }
  | { kind: 'message'; id: string; repoId: string; text: string; commandId?: string };

const BUCKET_ORDER: BucketKind[] = ['safe', 'squashMerged', 'warnings', 'protected', 'unscanned'];

const BUCKET_DISPLAY: Record<
  BucketKind,
  { label: string; icon: vscode.ThemeIcon; defaultExpanded: boolean }
> = {
  safe: {
    label: 'Safe',
    icon: new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green')),
    defaultExpanded: true,
  },
  squashMerged: {
    label: 'Squash-merged',
    icon: new vscode.ThemeIcon('check-all', new vscode.ThemeColor('charts.green')),
    defaultExpanded: true,
  },
  warnings: {
    label: 'Warnings',
    icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow')),
    defaultExpanded: false,
  },
  protected: {
    label: 'Protected',
    icon: new vscode.ThemeIcon('shield', new vscode.ThemeColor('charts.blue')),
    defaultExpanded: false,
  },
  unscanned: {
    label: 'Not Yet Assessed',
    icon: new vscode.ThemeIcon('circle-outline'),
    defaultExpanded: false,
  },
};

const STATUS_DISPLAY: Record<
  SafetyStatus,
  { bucket: BucketKind; icon: string; color: string | undefined }
> = {
  SAFE_MERGED: { bucket: 'safe', icon: 'check', color: 'charts.green' },
  SAFE_SQUASH_MERGED: { bucket: 'squashMerged', icon: 'check-all', color: 'charts.green' },
  WARNING_CLOSED_PR: {
    bucket: 'warnings',
    icon: 'git-pull-request-closed',
    color: 'charts.orange',
  },
  WARNING_UNMERGED: { bucket: 'warnings', icon: 'git-pull-request', color: 'charts.yellow' },
  WARNING_NO_PR: { bucket: 'warnings', icon: 'warning', color: 'charts.yellow' },
  UNKNOWN: { bucket: 'warnings', icon: 'question', color: 'charts.yellow' },
  PROTECTED: { bucket: 'protected', icon: 'shield', color: 'charts.blue' },
  CURRENT: { bucket: 'protected', icon: 'target', color: 'charts.purple' },
};

const UNSCANNED_CONTEXT_VALUE = 'UNSCANNED';

export function statusToBucket(status: SafetyStatus): BucketKind {
  return STATUS_DISPLAY[status].bucket;
}

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

function formatRelativeDate(date: Date, now = Date.now()): string {
  const diffMs = date.getTime() - now;
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (Math.abs(diffMs) >= unitMs || unit === 'second') {
      return RELATIVE_TIME_FORMAT.format(Math.round(diffMs / unitMs), unit);
    }
  }
  return RELATIVE_TIME_FORMAT.format(0, 'second');
}

function buildTooltip(branchAssessment: BranchAssessment | undefined): vscode.MarkdownString {
  if (!branchAssessment) {
    return new vscode.MarkdownString(
      'Not yet assessed. Run **Pollard: Scan** to evaluate this branch.'
    );
  }
  const { assessment, pullRequest } = branchAssessment;
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${assessment.status}** (score ${assessment.score})\n\n`);
  for (const reason of assessment.reasons) {
    md.appendMarkdown(`- ${reason}\n`);
  }
  if (pullRequest) {
    md.appendMarkdown(`\n[View pull request #${pullRequest.id}](${pullRequest.url})`);
  }
  return md;
}

/**
 * TreeDataProvider for pollard.branches. Renders live git structure
 * (repos/branches, via RepoRegistry) grouped by safety status, but never
 * computes that status itself — safety/PR data is only ever what's handed
 * in through updateAssessments(). Wiring that up to providers + the safety
 * engine + the cache is a future pollard.scan implementation.
 */
export class BranchTreeProvider
  implements vscode.TreeDataProvider<BranchTreeElement>, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private readonly assessmentsByRepo = new Map<string, Map<string, BranchAssessment>>();
  private readonly scannedRepoIds = new Set<string>();

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly registry: RepoRegistry) {
    this.disposables.push(
      registry.onDidChangeRepos(() => {
        this.updateHasGitRepoContext();
        this.updateHasScannedContext();
        this._onDidChangeTreeData.fire(undefined);
      }),
      registry.onDidChangeRefs((repoId) => this.fireRepoChange(repoId))
    );
    this.updateHasGitRepoContext();
    this.updateHasScannedContext();
  }

  /** Replace-all semantics for one repo's assessments. */
  updateAssessments(repoId: string, assessments: Map<string, BranchAssessment>): void {
    this.assessmentsByRepo.set(repoId, assessments);
    this.scannedRepoIds.add(repoId);
    this.updateHasScannedContext();
    this._onDidChangeTreeData.fire(undefined);
  }

  clearAssessments(repoId: string): void {
    this.assessmentsByRepo.delete(repoId);
    this.scannedRepoIds.delete(repoId);
    this.updateHasScannedContext();
    this._onDidChangeTreeData.fire(undefined);
  }

  refresh(repoId?: string): void {
    if (repoId) {
      this.fireRepoChange(repoId);
    } else {
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: BranchTreeElement): vscode.TreeItem | Thenable<vscode.TreeItem> {
    switch (element.kind) {
      case 'repo':
        return this.buildRepoTreeItem(element);
      case 'bucket':
        return this.buildBucketTreeItem(element);
      case 'branch':
        return this.buildBranchTreeItem(element);
      case 'message':
        return this.buildMessageTreeItem(element);
    }
  }

  getChildren(element?: BranchTreeElement): BranchTreeElement[] {
    if (!element) return this.getRootChildren();
    switch (element.kind) {
      case 'repo':
        return this.getRepoChildren(element.repoId);
      case 'bucket':
        return this.getBucketChildren(element.repoId, element.bucket);
      case 'branch':
      case 'message':
        return [];
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }

  private getRootChildren(): BranchTreeElement[] {
    const repos = this.registry.repos;
    if (repos.length === 0) return [];
    if (repos.length === 1) return this.getRepoChildren(repos[0].id);
    return repos.map((r) => makeRepoElement(r.id));
  }

  private getRepoChildren(repoId: string): BranchTreeElement[] {
    const repo = this.registry.repos.find((r) => r.id === repoId);
    if (!repo) return [];
    if (!this.scannedRepoIds.has(repoId)) {
      return [
        makeMessageElement(
          repoId,
          'not-scanned',
          'Not yet scanned — run Pollard: Scan',
          'pollard.scan'
        ),
      ];
    }
    if (repo.branches.length === 0) {
      return [makeMessageElement(repoId, 'no-branches', 'No local branches found.')];
    }

    const assessments = this.assessmentsByRepo.get(repoId);
    const bucketsWithBranches = new Set<BucketKind>();
    for (const branch of repo.branches) {
      const a = assessments?.get(branch.name);
      bucketsWithBranches.add(a ? statusToBucket(a.assessment.status) : 'unscanned');
    }
    return BUCKET_ORDER.filter((b) => bucketsWithBranches.has(b)).map((b) =>
      makeBucketElement(repoId, b)
    );
  }

  private getBucketChildren(repoId: string, bucket: BucketKind): BranchTreeElement[] {
    const repo = this.registry.repos.find((r) => r.id === repoId);
    if (!repo) return [];
    const assessments = this.assessmentsByRepo.get(repoId);

    const matching = repo.branches.filter((b) => {
      const a = assessments?.get(b.name);
      return (a ? statusToBucket(a.assessment.status) : 'unscanned') === bucket;
    });
    matching.sort((a, b) => {
      const scoreA = assessments?.get(a.name)?.assessment.score ?? -1;
      const scoreB = assessments?.get(b.name)?.assessment.score ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.name.localeCompare(b.name);
    });
    return matching.map((b) => makeBranchElement(repoId, b.name, b.sha));
  }

  private buildRepoTreeItem(
    element: Extract<BranchTreeElement, { kind: 'repo' }>
  ): vscode.TreeItem {
    const repo = this.registry.repos.find((r) => r.id === element.repoId);
    const item = new vscode.TreeItem(
      repo?.label ?? element.repoId,
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.id = element.id;
    item.description = repo?.currentBranch;
    item.tooltip = repo?.rootPath;
    item.iconPath = new vscode.ThemeIcon('repo');
    item.contextValue = 'pollard.repo';
    return item;
  }

  private buildBucketTreeItem(
    element: Extract<BranchTreeElement, { kind: 'bucket' }>
  ): vscode.TreeItem {
    const display = BUCKET_DISPLAY[element.bucket];
    const state = display.defaultExpanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(display.label, state);
    item.id = element.id;
    item.iconPath = display.icon;
    item.contextValue = `pollard.bucket.${element.bucket}`;
    return item;
  }

  private async buildBranchTreeItem(
    element: Extract<BranchTreeElement, { kind: 'branch' }>
  ): Promise<vscode.TreeItem> {
    const branchAssessment = this.assessmentsByRepo.get(element.repoId)?.get(element.branchName);
    const item = new vscode.TreeItem(element.branchName, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;

    const status = branchAssessment?.assessment.status;
    const display = status ? STATUS_DISPLAY[status] : { icon: 'circle-outline', color: undefined };
    item.iconPath = new vscode.ThemeIcon(
      display.icon,
      display.color ? new vscode.ThemeColor(display.color) : undefined
    );
    item.contextValue = status ?? UNSCANNED_CONTEXT_VALUE;

    const date = await this.registry.getCommitDate(element.repoId, element.sha);
    const relative = date ? formatRelativeDate(date) : undefined;
    const scoreText = branchAssessment ? String(branchAssessment.assessment.score) : undefined;
    item.description = [scoreText, relative].filter(Boolean).join(' · ') || undefined;

    item.tooltip = buildTooltip(branchAssessment);
    return item;
  }

  private buildMessageTreeItem(
    element: Extract<BranchTreeElement, { kind: 'message' }>
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.iconPath = new vscode.ThemeIcon('info');
    item.contextValue = 'pollard.message';
    if (element.commandId) {
      item.command = { command: element.commandId, title: element.text };
    }
    return item;
  }

  private fireRepoChange(repoId: string): void {
    if (this.registry.repos.length > 1) {
      this._onDidChangeTreeData.fire(makeRepoElement(repoId));
    } else {
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  private updateHasGitRepoContext(): void {
    void vscode.commands.executeCommand(
      'setContext',
      'pollard.hasGitRepo',
      this.registry.repos.length > 0
    );
  }

  /** Meaningful only when there are 0 or 1 open repos — see the module-level design note in the plan. */
  private updateHasScannedContext(): void {
    const repos = this.registry.repos;
    const hasScanned =
      repos.length === 0 || (repos.length === 1 && this.scannedRepoIds.has(repos[0].id));
    void vscode.commands.executeCommand('setContext', 'pollard.hasScanned', hasScanned);
  }
}

function makeRepoElement(repoId: string): BranchTreeElement {
  return { kind: 'repo', id: `repo:${repoId}`, repoId };
}

function makeBucketElement(repoId: string, bucket: BucketKind): BranchTreeElement {
  return { kind: 'bucket', id: `bucket:${repoId}:${bucket}`, repoId, bucket };
}

function makeBranchElement(repoId: string, branchName: string, sha: string): BranchTreeElement {
  return { kind: 'branch', id: `branch:${repoId}:${branchName}`, repoId, branchName, sha };
}

function makeMessageElement(
  repoId: string,
  slug: string,
  text: string,
  commandId?: string
): BranchTreeElement {
  return { kind: 'message', id: `message:${repoId}:${slug}`, repoId, text, commandId };
}
