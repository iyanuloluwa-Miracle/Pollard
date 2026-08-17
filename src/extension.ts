import * as vscode from 'vscode';

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
    })
  );
}

export function deactivate(): void {}
