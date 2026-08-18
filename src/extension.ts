import * as vscode from 'vscode';
import { runPruneBackups } from './backup/prune';
import { runRestore } from './backup/restore';
import { CleanDeps, runClean, runCleanSingleBranch } from './clean/clean';
import { registerCleanPreviewProvider } from './clean/preview';
import { getAutoScanIntervalMinutes, getAutoScanOnStartup } from './config';
import { RepoRegistry } from './git/repo-registry';
import { connectGitlab } from './providers/gitlab/gitlab-auth';
import { getGithubSession } from './providers/github/github-auth';
import { runRefresh } from './scan/refresh';
import { runScan } from './scan/scan';
import { ScanDeps } from './scan/types';
import { clearCache } from './state/cache';
import { PollardTelemetryReporter } from './telemetry';
import { BranchTreeElement, BranchTreeProvider } from './views/branchTree';
import { StatusBarController } from './views/statusBar';

const MIN_AUTO_SCAN_INTERVAL_MINUTES = 5;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // No scan has run yet, so auth isn't known to be blocking anything —
  // avoid greeting a first-time user with a sign-in warning.
  void vscode.commands.executeCommand('setContext', 'pollard.isSignedIn', true);

  const registry = await RepoRegistry.create();
  const branchTreeProvider = new BranchTreeProvider(registry);
  const statusBar = new StatusBarController(registry);
  const logChannel = vscode.window.createOutputChannel('Pollard', { log: true });
  const telemetry = new PollardTelemetryReporter(logChannel);
  const scanDeps: ScanDeps = {
    context,
    registry,
    branchTreeProvider,
    statusBar,
    logChannel,
    telemetry,
  };
  const cleanDeps: CleanDeps = { ...scanDeps };

  context.subscriptions.push(
    registry,
    branchTreeProvider,
    statusBar,
    logChannel,
    telemetry,
    registerCleanPreviewProvider(),
    vscode.window.registerTreeDataProvider('pollard.branches', branchTreeProvider),
    vscode.commands.registerCommand('pollard.scan', () => runScan(scanDeps)),
    vscode.commands.registerCommand('pollard.clean', () => runClean(cleanDeps)),
    vscode.commands.registerCommand('pollard.restore', () => runRestore(cleanDeps)),
    vscode.commands.registerCommand('pollard.pruneBackups', () => runPruneBackups(cleanDeps)),
    vscode.commands.registerCommand('pollard.refresh', () => runRefresh(scanDeps)),
    vscode.commands.registerCommand('pollard.connectGithub', () => getGithubSession(true)),
    vscode.commands.registerCommand('pollard.connectGitlab', () => connectGitlab(context)),
    vscode.commands.registerCommand('pollard.clearCache', async () => {
      await clearCache(context);
      vscode.window.showInformationMessage('Pollard: Cache cleared.');
    }),
    vscode.commands.registerCommand('pollard.deleteBranch', (element: BranchTreeElement) => {
      if (element.kind !== 'branch') return;
      return runCleanSingleBranch(cleanDeps, element);
    })
  );

  // Both auto-scan mechanisms are strictly opt-in and default off — a fresh
  // install never scans (and never contacts GitHub/GitLab) automatically.
  if (getAutoScanOnStartup()) {
    void runScan(scanDeps);
  }
  const intervalMinutes = getAutoScanIntervalMinutes();
  if (intervalMinutes > 0) {
    const effectiveMinutes = Math.max(intervalMinutes, MIN_AUTO_SCAN_INTERVAL_MINUTES);
    const handle = setInterval(() => void runScan(scanDeps), effectiveMinutes * 60_000);
    context.subscriptions.push({ dispose: () => clearInterval(handle) });
  }
}

export function deactivate(): void {}
