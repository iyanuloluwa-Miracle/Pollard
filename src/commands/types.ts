import * as vscode from 'vscode';
import { TelemetryReporter } from '../errors';
import { PollardLogger } from '../logger';
import { RepoRegistry } from '../workspace/repositories';
import { BranchTreeProvider } from '../views/branchTree';
import { StatusBarController } from '../views/statusBar';

export interface ScanDeps {
  context: vscode.ExtensionContext;
  registry: RepoRegistry;
  branchTreeProvider: BranchTreeProvider;
  statusBar: StatusBarController;
  logChannel: PollardLogger;
  telemetry: TelemetryReporter;
}
