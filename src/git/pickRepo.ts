import * as vscode from 'vscode';
import { RepoHandle, RepoRegistry } from './repo-registry';

/** 0 repos → info message, undefined. 1 repo → returned directly. 2+ → a repo-picker QuickPick. */
export async function pickRepo(
  registry: RepoRegistry,
  title: string
): Promise<RepoHandle | undefined> {
  const repos = registry.repos;
  if (repos.length === 0) {
    vscode.window.showInformationMessage('Pollard: No Git repository found in this workspace.');
    return undefined;
  }
  if (repos.length === 1) return repos[0];

  const picked = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: r.label, description: r.rootPath, repo: r })),
    { title }
  );
  return picked?.repo;
}
