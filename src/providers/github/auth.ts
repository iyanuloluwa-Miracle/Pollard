import * as vscode from 'vscode';
import { fetchJson } from '../http';
import { AuthProbeStatus } from '../provider';

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

/**
 * Tri-state auth check for pollard.doctor: no existing code path distinguishes
 * "no session" from "session present but the token no longer works" — only a
 * real request can tell the two apart. Never logs or surfaces the token
 * itself, only the classification. A network/offline failure is not proof
 * the token is invalid, so it's reported as signedIn (session exists) rather
 * than a false tokenInvalid.
 */
export async function probeGithubAuth(enterpriseHost?: string): Promise<AuthProbeStatus> {
  const session = await getGithubSession(false);
  if (!session) return 'noSession';

  const graphqlUrl = enterpriseHost
    ? `https://${enterpriseHost}/api/graphql`
    : 'https://api.github.com/graphql';

  try {
    const { response } = await fetchJson(graphqlUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.accessToken}` },
      body: { query: '{ viewer { login } }' },
    });
    if (response.status === 401) return 'tokenInvalid';
    return 'signedIn';
  } catch {
    return 'signedIn';
  }
}
