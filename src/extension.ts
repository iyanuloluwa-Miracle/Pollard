import * as vscode from 'vscode';
import { RepoRegistry } from './git/repo-registry';
import { connectGitlab } from './providers/gitlab/gitlab-auth';
import { getGithubSession } from './providers/github/github-auth';
import { clearCache } from './state/cache';
import { BranchTreeProvider } from './views/branchTree';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // No scan has run yet, so auth isn't known to be blocking anything —
  // avoid greeting a first-time user with a sign-in warning.
  void vscode.commands.executeCommand('setContext', 'pollard.isSignedIn', true);

  const registry = await RepoRegistry.create();
  const branchTreeProvider = new BranchTreeProvider(registry);

  context.subscriptions.push(
    registry,
    branchTreeProvider,
    vscode.window.registerTreeDataProvider('pollard.branches', branchTreeProvider),
    vscode.commands.registerCommand('pollard.scan', () => {
      vscode.window.showInformationMessage('Pollard: Scan (not implemented yet)');
    }),
    vscode.commands.registerCommand('pollard.clean', () => {
      vscode.window.showInformationMessage('Pollard: Clean (not implemented yet)');
    }),
    vscode.commands.registerCommand('pollard.restore', () => {
      vscode.window.showInformationMessage('Pollard: Restore (not implemented yet)');
    }),
    vscode.commands.registerCommand('pollard.refresh', () => {
      branchTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('pollard.connectGithub', () => getGithubSession(true)),
    vscode.commands.registerCommand('pollard.connectGitlab', () => connectGitlab(context)),
    vscode.commands.registerCommand('pollard.clearCache', async () => {
      await clearCache(context);
      vscode.window.showInformationMessage('Pollard: Cache cleared.');
    })
  );
}

export function deactivate(): void {}
