import * as vscode from 'vscode';

/**
 * Never call with `interactive: true` from inside a provider method — that
 * would silently prompt the user during background work like a tree refresh.
 * `interactive: true` belongs only to an explicit user action, such as the
 * `pollard.connectGithub` command.
 */
export async function getGithubSession(
  interactive: boolean
): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession('github', ['repo'], { createIfNone: interactive });
}
