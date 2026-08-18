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

export interface CreateProviderResult {
  provider: Provider;
  /** Set only when the provider is a NoopProvider chosen for an explainable reason (as opposed to no remote/host configured at all being unremarkable). */
  reason?: 'noRemote' | 'unrecognisedHost';
}

/**
 * Picks GitHub, GitLab, or a NoopProvider based on the parsed remote's host,
 * matching github.com/gitlab.com or the configured enterprise/self-hosted host.
 */
export function createProvider({
  context,
  remote,
  resourcePath,
}: CreateProviderOptions): CreateProviderResult {
  if (!remote) return { provider: new NoopProvider(), reason: 'noRemote' };

  const githubEnterpriseHost = getGitHubEnterpriseHost(resourcePath);
  const gitlabInstanceHost = getGitLabHost(resourcePath);

  if (
    remote.host === 'github.com' ||
    (githubEnterpriseHost && remote.host === githubEnterpriseHost)
  ) {
    return {
      provider: new GitHubProvider(remote, remote.host === 'github.com' ? undefined : remote.host),
    };
  }
  if (remote.host === 'gitlab.com' || (gitlabInstanceHost && remote.host === gitlabInstanceHost)) {
    return {
      provider: new GitLabProvider(
        context,
        remote,
        remote.host === 'gitlab.com' ? undefined : remote.host
      ),
    };
  }
  return { provider: new NoopProvider(), reason: 'unrecognisedHost' };
}
