import * as vscode from 'vscode';
import { RepoRegistry } from './git/repo-registry';
import { connectGitlab } from './providers/gitlab/gitlab-auth';
import { getGithubSession } from './providers/github/github-auth';
import { runRefresh } from './scan/refresh';
import { runScan } from './scan/scan';
import { ScanDeps } from './scan/types';
import { clearCache } from './state/cache';
import { BranchTreeProvider } from './views/branchTree';
import { StatusBarController } from './views/statusBar';

const MIN_AUTO_SCAN_INTERVAL_MINUTES = 5;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // No scan has run yet, so auth isn't known to be blocking anything —
  // avoid greeting a first-time user with a sign-in warning.
  void vscode.commands.executeCommand('setContext', 'pollard.isSignedIn', true);

  const registry = await RepoRegistry.create();
  const branchTreeProvider = new BranchTreeProvider(registry);
  const statusBar = new StatusBarController(registry);
  const deps: ScanDeps = { context, registry, branchTreeProvider, statusBar };

  context.subscriptions.push(
    registry,
    branchTreeProvider,
    statusBar,
    vscode.window.registerTreeDataProvider('pollard.branches', branchTreeProvider),
    vscode.commands.registerCommand('pollard.scan', () => runScan(deps)),
    vscode.commands.registerCommand('pollard.clean', () => {
      vscode.window.showInformationMessage('Pollard: Clean (not implemented yet)');
    }),
    vscode.commands.registerCommand('pollard.restore', () => {
      vscode.window.showInformationMessage('Pollard: Restore (not implemented yet)');
    }),
    vscode.commands.registerCommand('pollard.refresh', () => runRefresh(deps)),
    vscode.commands.registerCommand('pollard.connectGithub', () => getGithubSession(true)),
    vscode.commands.registerCommand('pollard.connectGitlab', () => connectGitlab(context)),
    vscode.commands.registerCommand('pollard.clearCache', async () => {
      await clearCache(context);
      vscode.window.showInformationMessage('Pollard: Cache cleared.');
    })
  );

  // Both auto-scan mechanisms are strictly opt-in and default off — a fresh
  // install never scans (and never contacts GitHub/GitLab) automatically.
  const config = vscode.workspace.getConfiguration('pollard');
  if (config.get<boolean>('autoScanOnStartup', false)) {
    void runScan(deps);
  }
  const intervalMinutes = config.get<number>('autoScanIntervalMinutes', 0);
  if (intervalMinutes > 0) {
    const effectiveMinutes = Math.max(intervalMinutes, MIN_AUTO_SCAN_INTERVAL_MINUTES);
    const handle = setInterval(() => void runScan(deps), effectiveMinutes * 60_000);
    context.subscriptions.push({ dispose: () => clearInterval(handle) });
  }
}

export function deactivate(): void {}
