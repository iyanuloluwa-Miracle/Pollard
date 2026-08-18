import * as vscode from 'vscode';

const GITLAB_PAT_KEY = 'pollard.gitlab.pat';

/** Reads the stored GitLab PAT. Never falls back to settings — a PAT must not land in plaintext config. */
export async function getGitlabToken(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  return context.secrets.get(GITLAB_PAT_KEY);
}

/**
 * Prompts for and stores a GitLab personal access token via SecretStorage.
 * This is the only place the token is written, and it only runs in response
 * to an explicit user action (the `pollard.connectGitlab` command) — never
 * called automatically from provider methods.
 */
export async function connectGitlab(context: vscode.ExtensionContext): Promise<void> {
  const token = await vscode.window.showInputBox({
    prompt: 'Enter a GitLab personal access token (needs `read_api` scope)',
    password: true,
    ignoreFocusOut: true,
  });
  if (token) await context.secrets.store(GITLAB_PAT_KEY, token);
}
