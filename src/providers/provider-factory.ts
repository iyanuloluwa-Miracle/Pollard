import * as vscode from 'vscode';
import { getGitHubEnterpriseHost, getGitLabHost } from '../config';
import { ParsedRemote } from '../git/remote-url';
import { GitHubProvider } from './github/github-provider';
import { GitLabProvider } from './gitlab/gitlab-provider';
import { NoopProvider } from './noop-provider';
import { Provider } from './types';

export interface CreateProviderOptions {
  context: vscode.ExtensionContext;
  remote: ParsedRemote | undefined;
  /** Repo root path — threads through to gitlabHost/github.enterpriseHost, both resource-scoped settings. */
  resourcePath?: string;
}

/**
 * Picks GitHub, GitLab, or a NoopProvider based on the parsed remote's host,
 * matching github.com/gitlab.com or the configured enterprise/self-hosted host.
 */
export function createProvider({ context, remote, resourcePath }: CreateProviderOptions): Provider {
  if (!remote) return new NoopProvider();

  const githubEnterpriseHost = getGitHubEnterpriseHost(resourcePath);
  const gitlabInstanceHost = getGitLabHost(resourcePath);

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
