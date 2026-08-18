import * as os from 'os';
import * as vscode from 'vscode';
import { getGitVersion, listBackupRefs, resolveDefaultBranch, RemoteInfo } from '../git';
import {
  AuthProbeStatus,
  createProvider,
  primaryRemoteFetchUrl,
  probeGithubAuth,
  probeGitlabAuth,
  resolvePrimaryParsedRemote,
} from '../providers';
import { RepoCache } from '../state';
import { formatRelativeDate } from '../util';
import { RepoHandle } from '../workspace';
import { ScanDeps } from './types';

const LOG_TAIL_LINES = 20;

/** Never the remote's full fetch URL — host only. */
function redactedRemoteHost(remotes: RemoteInfo[]): string {
  return resolvePrimaryParsedRemote(remotes)?.host ?? '(no remote configured)';
}

function formatAuthStatus(status: AuthProbeStatus): string {
  switch (status) {
    case 'signedIn':
      return 'signed in';
    case 'noSession':
      return 'no session';
    case 'tokenInvalid':
      return 'token invalid';
  }
}

async function reportRepoSection(deps: ScanDeps, repo: RepoHandle): Promise<string> {
  const lines: string[] = [`## ${repo.label}`, ''];
  lines.push(`- Root path: ${repo.rootPath}`);
  lines.push(`- Remote host: ${redactedRemoteHost(repo.remotes)}`);

  const parsedRemote = resolvePrimaryParsedRemote(repo.remotes);
  const { provider, reason } = createProvider({
    context: deps.context,
    remote: parsedRemote,
    resourcePath: repo.rootPath,
  });

  let defaultBranchLine = '- Default branch: (unresolved)';
  try {
    const defaultBranch = await resolveDefaultBranch(deps.registry, repo);
    if (defaultBranch) defaultBranchLine = `- Default branch: ${defaultBranch.name}`;
  } catch {
    // Leave the "(unresolved)" default — this is a best-effort report.
  }
  lines.push(defaultBranchLine);

  if (provider.id === 'noop') {
    const reasonText =
      reason === 'noRemote'
        ? 'no remote configured'
        : reason === 'unrecognisedHost'
          ? 'remote host not recognised as GitHub/GitLab'
          : 'n/a';
    lines.push(`- Provider: none (${reasonText})`);
  } else {
    const enterpriseHost = parsedRemote?.host === 'github.com' ? undefined : parsedRemote?.host;
    let authStatus: AuthProbeStatus;
    try {
      authStatus =
        provider.id === 'github'
          ? await probeGithubAuth(enterpriseHost)
          : await probeGitlabAuth(deps.context, enterpriseHost);
    } catch {
      authStatus = 'noSession';
    }
    lines.push(`- Provider: ${provider.id}`);
    lines.push(`- Auth status: ${formatAuthStatus(authStatus)}`);

    const rateLimit = provider.getRateLimitStatus();
    if (rateLimit.limit === null && rateLimit.remaining === null) {
      lines.push('- Rate limit: no data yet (no request made against this host this session)');
    } else {
      const resetText = rateLimit.resetAt ? formatRelativeDate(rateLimit.resetAt) : 'unknown';
      lines.push(
        `- Rate limit: ${rateLimit.remaining ?? '?'}/${rateLimit.limit ?? '?'} remaining` +
          `${rateLimit.isLimited ? ' (currently limited)' : ''}, resets ${resetText}`
      );
    }
  }

  const cache = new RepoCache(
    deps.context,
    repo.rootPath,
    primaryRemoteFetchUrl(repo.remotes),
    undefined,
    deps.logChannel
  );
  lines.push(`- Cache file: ${cache.getFilePath()}`);
  try {
    const lastFetchedAt = await cache.getLastFetchedAt();
    lines.push(
      `- Last scan: ${lastFetchedAt ? formatRelativeDate(new Date(lastFetchedAt)) : 'never'}`
    );
  } catch {
    lines.push('- Last scan: (unavailable)');
  }

  try {
    const backupCount = (await listBackupRefs(deps.registry, repo.id, deps.logChannel)).length;
    lines.push(`- Backup refs: ${backupCount}`);
  } catch {
    lines.push('- Backup refs: (unavailable)');
  }

  lines.push('');
  return lines.join('\n');
}

async function buildReport(deps: ScanDeps): Promise<string> {
  const lines: string[] = [
    '# Pollard Diagnostics Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Environment',
    '',
    `- Pollard version: ${deps.context.extension.packageJSON.version ?? 'unknown'}`,
    `- VS Code version: ${vscode.version}`,
    `- OS: ${os.platform()} ${os.release()}`,
  ];

  const gitVersion = await getGitVersion();
  lines.push(`- Git version: ${gitVersion ?? 'not found on PATH'}`);
  lines.push(`- vscode.git extension resolved: ${!!vscode.extensions.getExtension('vscode.git')}`);
  lines.push('');

  await deps.registry.whenReady();
  const repos = deps.registry.repos;
  lines.push('## Repositories', '');
  if (repos.length === 0) {
    lines.push('(no git repository open in this workspace)', '');
  } else {
    for (const repo of repos) {
      lines.push(await reportRepoSection(deps, repo));
    }
  }

  lines.push(`## Recent log (last ${LOG_TAIL_LINES} lines)`, '', '```');
  lines.push(...deps.logChannel.getRecentLines(LOG_TAIL_LINES));
  lines.push('```', '');

  return lines.join('\n');
}

/** Entry point for pollard.doctor. Opens the report in an untitled markdown editor and offers to copy it for an issue report. */
export async function runDoctor(deps: ScanDeps): Promise<void> {
  const report = await buildReport(deps);

  const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
  await vscode.window.showTextDocument(doc);

  const choice = await vscode.window.showInformationMessage(
    'Pollard: Diagnostics report generated.',
    'Copy for Issue Report'
  );
  if (choice === 'Copy for Issue Report') {
    await vscode.env.clipboard.writeText(report);
    void vscode.window.showInformationMessage('Pollard: Diagnostics report copied to clipboard.');
  }
}
