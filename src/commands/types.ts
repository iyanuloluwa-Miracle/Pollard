import * as vscode from 'vscode';
import { TelemetryReporter } from '../errors';
import { PollardLogger } from '../logger';
import { RepoRegistry } from '../workspace';
import { BranchTreeProvider } from '../views';
import { StatusBarController } from '../views';

export interface ScanDeps {
  context: vscode.ExtensionContext;
  registry: RepoRegistry;
  branchTreeProvider: BranchTreeProvider;
  statusBar: StatusBarController;
  logChannel: PollardLogger;
  telemetry: TelemetryReporter;
}
