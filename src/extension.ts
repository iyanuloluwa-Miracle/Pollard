import * as vscode from 'vscode';
import { connectGitlab } from './providers/gitlab/gitlab-auth';
import { getGithubSession } from './providers/github/github-auth';
import { clearCache } from './state/cache';

class EmptyBranchesProvider implements vscode.TreeDataProvider<never> {
  getTreeItem(element: never): vscode.TreeItem {
    return element;
  }
  getChildren(): Thenable<never[]> {
    return Promise.resolve([]);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('pollard.branches', new EmptyBranchesProvider()),
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
      vscode.window.showInformationMessage('Pollard: Refresh (not implemented yet)');
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
