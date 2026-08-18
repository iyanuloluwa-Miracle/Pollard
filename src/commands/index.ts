import * as vscode from 'vscode';
import { connectGitlab } from '../providers/gitlab/auth';
import { getGithubSession } from '../providers/github/auth';
import { BranchTreeElement } from '../views/items';
import { CleanDeps, runClean, runCleanSingleBranch } from './clean';
import { runClearCache } from './clearCache';
import { runPruneBackups } from './pruneBackups';
import { runRefresh } from './refresh';
import { runRestore } from './restore';
import { runScan } from './scan';
import { ScanDeps } from './types';

export { runScan } from './scan';

/** Registers every pollard.* command. Returns the disposables for the caller to push into context.subscriptions. */
export function registerCommands(
  context: vscode.ExtensionContext,
  scanDeps: ScanDeps
): vscode.Disposable[] {
  const cleanDeps: CleanDeps = { ...scanDeps };

  return [
    vscode.commands.registerCommand('pollard.scan', () => runScan(scanDeps)),
    vscode.commands.registerCommand('pollard.clean', () => runClean(cleanDeps)),
    vscode.commands.registerCommand('pollard.restore', () => runRestore(cleanDeps)),
    vscode.commands.registerCommand('pollard.pruneBackups', () => runPruneBackups(cleanDeps)),
    vscode.commands.registerCommand('pollard.refresh', () => runRefresh(scanDeps)),
    vscode.commands.registerCommand('pollard.connectGithub', () => getGithubSession(true)),
    vscode.commands.registerCommand('pollard.connectGitlab', () => connectGitlab(context)),
    vscode.commands.registerCommand('pollard.clearCache', () => runClearCache(context)),
    vscode.commands.registerCommand('pollard.deleteBranch', (element: BranchTreeElement) => {
      if (element.kind !== 'branch') return;
      return runCleanSingleBranch(cleanDeps, element);
    }),
  ];
}
