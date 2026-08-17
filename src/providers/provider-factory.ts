import * as vscode from 'vscode';
import { ParsedRemote } from '../git/remote-url';
import { GitHubProvider } from './github/github-provider';
import { GitLabProvider } from './gitlab/gitlab-provider';
import { NoopProvider } from './noop-provider';
import { Provider } from './types';

export interface CreateProviderOptions {
  context: vscode.ExtensionContext;
  remote: ParsedRemote | undefined;
}

/**
 * Picks GitHub, GitLab, or a NoopProvider based on the parsed remote's host,
 * matching github.com/gitlab.com or the configured enterprise/self-hosted host.
 */
export function createProvider({ context, remote }: CreateProviderOptions): Provider {
  if (!remote) return new NoopProvider();

  const config = vscode.workspace.getConfiguration('pollard');
  const githubEnterpriseHost = config.get<string>('github.enterpriseHost')?.toLowerCase();
  const gitlabInstanceHost = hostOf(config.get<string>('gitlab.instanceUrl'));

  if (
    remote.host === 'github.com' ||
    (githubEnterpriseHost && remote.host === githubEnterpriseHost)
  ) {
    return new GitHubProvider(remote, remote.host === 'github.com' ? undefined : remote.host);
  }
  if (remote.host === 'gitlab.com' || (gitlabInstanceHost && remote.host === gitlabInstanceHost)) {
    return new GitLabProvider(
      context,
      remote,
      remote.host === 'gitlab.com' ? undefined : remote.host
    );
  }
  return new NoopProvider();
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}
