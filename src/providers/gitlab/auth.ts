import * as vscode from 'vscode';
import { fetchJson } from '../http';
import { AuthProbeStatus } from '../provider';

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

/**
 * Tri-state auth check for pollard.doctor: getGitlabToken only tells you
 * whether a PAT is stored, not whether it still works — only a real request
 * can tell the two apart. Never logs or surfaces the token itself, only the
 * classification. A network/offline failure is not proof the token is
 * invalid, so it's reported as signedIn (PAT is stored) rather than a false
 * tokenInvalid.
 */
export async function probeGitlabAuth(
  context: vscode.ExtensionContext,
  instanceHost?: string
): Promise<AuthProbeStatus> {
  const token = await getGitlabToken(context);
  if (!token) return 'noSession';

  const apiBase = `https://${instanceHost ?? 'gitlab.com'}/api/v4`;
  try {
    const { response } = await fetchJson(`${apiBase}/user`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (response.status === 401) return 'tokenInvalid';
    return 'signedIn';
  } catch {
    return 'signedIn';
  }
}
