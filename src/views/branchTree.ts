import * as vscode from 'vscode';
import { RepoRegistry } from '../workspace/repositories';
import { statusIconAndColor, statusToBucket, UNSCANNED_CONTEXT_VALUE, BucketKind } from '../safety/status';
import { BranchAssessment, SafetyStatus } from '../safety/types';
import { formatRelativeDate } from '../util/relative-time';
import {
  BranchTreeElement,
  makeBannerElement,
  makeBranchElement,
  makeBucketElement,
  makeMessageElement,
  makeRepoElement,
} from './items';

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
  private readonly providerReasonByRepo = new Map<string, 'noRemote' | 'unrecognisedHost'>();
  private offlineBannerActive = false;

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
    // registry.repos is empty until the background enumeration in
    // RepoRegistry.initialize() completes — recompute contexts once it has,
    // rather than reporting "no repo" here while that's still in flight.
    void registry.whenReady().then(() => {
      this.updateHasGitRepoContext();
      this.updateHasScannedContext();
      this._onDidChangeTreeData.fire(undefined);
    });
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

  /**
   * Single-entry add/update/remove — undefined removes. Used for instant
   * feedback right after a delete/restore without waiting for the debounced
   * FS-watcher refresh, and without clobbering the rest of that repo's map
   * (unlike updateAssessments's replace-all semantics).
   */
  setAssessment(
    repoId: string,
    branchName: string,
    assessment: BranchAssessment | undefined
  ): void {
    let map = this.assessmentsByRepo.get(repoId);
    if (!map) {
      if (assessment === undefined) return;
      map = new Map();
      this.assessmentsByRepo.set(repoId, map);
    }
    if (assessment === undefined) map.delete(branchName);
    else map.set(branchName, assessment);
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Read-only snapshot of one repo's assessments, or undefined if unscanned. */
  getAssessments(repoId: string): Map<string, BranchAssessment> | undefined {
    return this.assessmentsByRepo.get(repoId);
  }

  /** Repo-independent (machine-wide connectivity), unlike a 'message' element — explicit set/clear lifecycle. Fires a refresh only on actual state change. */
  setOfflineBanner(active: boolean): void {
    if (this.offlineBannerActive === active) return;
    this.offlineBannerActive = active;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Per-repo explanation for why no PR/MR data is available (no remote configured, or an unrecognised host) — reason undefined clears it. */
  setProviderReason(repoId: string, reason: 'noRemote' | 'unrecognisedHost' | undefined): void {
    const prev = this.providerReasonByRepo.get(repoId);
    if (prev === reason) return;
    if (reason === undefined) this.providerReasonByRepo.delete(repoId);
    else this.providerReasonByRepo.set(repoId, reason);
    this.fireRepoChange(repoId);
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
      case 'banner':
        return this.buildBannerTreeItem(element);
    }
  }

  /** Async so the first call — driven by the tree actually rendering — is what the repo enumeration cost lands behind, instead of activate() blocking on it. */
  async getChildren(element?: BranchTreeElement): Promise<BranchTreeElement[]> {
    await this.registry.whenReady();
    if (!element) return this.getRootChildren();
    switch (element.kind) {
      case 'repo':
        return this.getRepoChildren(element.repoId);
      case 'bucket':
        return this.getBucketChildren(element.repoId, element.bucket);
      case 'branch':
      case 'message':
      case 'banner':
        return [];
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }

  private getRootChildren(): BranchTreeElement[] {
    const banner = this.offlineBannerActive ? [makeBannerElement()] : [];
    const repos = this.registry.repos;
    if (repos.length === 0) return banner;
    if (repos.length === 1) return [...banner, ...this.getRepoChildren(repos[0].id)];
    return [...banner, ...repos.map((r) => makeRepoElement(r.id))];
  }

  private buildProviderReasonMessage(repoId: string): BranchTreeElement[] {
    const reason = this.providerReasonByRepo.get(repoId);
    if (!reason) return [];
    const text =
      reason === 'noRemote'
        ? 'No remote configured — showing local branch status only.'
        : 'Remote host not recognised as GitHub/GitLab — showing local branch status only.';
    return [makeMessageElement(repoId, `provider-reason-${reason}`, text)];
  }

  private getRepoChildren(repoId: string): BranchTreeElement[] {
    const repo = this.registry.repos.find((r) => r.id === repoId);
    if (!repo) return [];
    const reasonMessage = this.buildProviderReasonMessage(repoId);
    if (!this.scannedRepoIds.has(repoId)) {
      return [
        ...reasonMessage,
        makeMessageElement(
          repoId,
          'not-scanned',
          'Not yet scanned — run Pollard: Scan',
          'pollard.scan'
        ),
      ];
    }
    if (repo.branches.length === 0) {
      return [
        ...reasonMessage,
        makeMessageElement(repoId, 'no-branches', 'No local branches found.'),
      ];
    }

    const assessments = this.assessmentsByRepo.get(repoId);
    const bucketsWithBranches = new Set<BucketKind>();
    for (const branch of repo.branches) {
      const a = assessments?.get(branch.name);
      bucketsWithBranches.add(a ? statusToBucket(a.assessment.status) : 'unscanned');
    }
    return [
      ...reasonMessage,
      ...BUCKET_ORDER.filter((b) => bucketsWithBranches.has(b)).map((b) =>
        makeBucketElement(repoId, b)
      ),
    ];
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

    const status: SafetyStatus | undefined = branchAssessment?.assessment.status;
    const display = status ? statusIconAndColor(status) : { icon: 'circle-outline', color: undefined };
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

  private buildBannerTreeItem(
    element: Extract<BranchTreeElement, { kind: 'banner' }>
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.iconPath = new vscode.ThemeIcon('cloud-offline', new vscode.ThemeColor('charts.orange'));
    item.contextValue = 'pollard.banner';
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
