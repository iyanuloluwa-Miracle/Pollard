import * as vscode from 'vscode';
import { classifyNotAGitRepo, PollardCommandId, presentError, TelemetryReporter } from '../errors';
import { RepoHandle, RepoRegistry } from './repo-registry';

export interface PickRepoErrorContext {
  logChannel: vscode.LogOutputChannel;
  telemetry: TelemetryReporter;
  command: PollardCommandId;
}

/** 0 repos → routed through classifyNotAGitRepo/presentError, undefined. 1 repo → returned directly. 2+ → a repo-picker QuickPick. */
export async function pickRepo(
  registry: RepoRegistry,
  title: string,
  errCtx: PickRepoErrorContext
): Promise<RepoHandle | undefined> {
  const repos = registry.repos;
  if (repos.length === 0) {
    presentError(classifyNotAGitRepo(), errCtx);
    return undefined;
  }
  if (repos.length === 1) return repos[0];

  const picked = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: r.label, description: r.rootPath, repo: r })),
    { title }
  );
  return picked?.repo;
}
