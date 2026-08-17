import * as vscode from 'vscode';
import { RepoRegistry } from '../git/repo-registry';
import { BranchTreeProvider } from '../views/branchTree';
import { StatusBarController } from '../views/statusBar';

export interface ScanDeps {
  context: vscode.ExtensionContext;
  registry: RepoRegistry;
  branchTreeProvider: BranchTreeProvider;
  statusBar: StatusBarController;
}
