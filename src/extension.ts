import * as vscode from 'vscode';
import { registerCommands, runScan } from './commands';
import { ScanDeps } from './commands/types';
import { getAutoScanIntervalMinutes, getAutoScanOnStartup } from './config';
import { PollardLogger } from './logger';
import { PollardTelemetryReporter } from './telemetry';
import { BranchTreeProvider } from './views/branchTree';
import { registerCleanPreviewProvider } from './views/previewDocument';
import { StatusBarController } from './views/statusBar';
import { RepoRegistry } from './workspace/repositories';

const MIN_AUTO_SCAN_INTERVAL_MINUTES = 5;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activationStart = Date.now();

  // No scan has run yet, so auth isn't known to be blocking anything —
  // avoid greeting a first-time user with a sign-in warning.
  void vscode.commands.executeCommand('setContext', 'pollard.isSignedIn', true);

  // RepoRegistry.create() returns synchronously — it does no git or
  // filesystem work here. The real repo enumeration runs in the background
  // and is only ever awaited (via registry.whenReady()) from the tree
  // provider's first getChildren call and from command handlers, so it
  // never blocks activation itself. See PERFORMANCE.md.
  const registry = RepoRegistry.create();
  const branchTreeProvider = new BranchTreeProvider(registry);
  const statusBar = new StatusBarController(registry);
  const logChannel = new PollardLogger('Pollard');
  const telemetry = new PollardTelemetryReporter(logChannel);
  const scanDeps: ScanDeps = {
    context,
    registry,
    branchTreeProvider,
    statusBar,
    logChannel,
    telemetry,
  };

  context.subscriptions.push(
    registry,
    branchTreeProvider,
    statusBar,
    logChannel,
    telemetry,
    registerCleanPreviewProvider(),
    vscode.window.registerTreeDataProvider('pollard.branches', branchTreeProvider),
    ...registerCommands(context, scanDeps)
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

  logChannel.trace(`activate() returned in ${Date.now() - activationStart}ms`);
}

export function deactivate(): void {}
