import * as vscode from 'vscode';
import {
  DEFAULT_PROTECTED_BRANCH_PATTERNS,
  matchesAnyPattern,
  resolveProtectedBranchPatterns,
} from './git/protected-branches';

/**
 * The single place that reads vscode.workspace.getConfiguration('pollard')
 * — every other file gets settings through the functions below instead of
 * calling getConfiguration directly, so each setting's key/default/
 * resolution logic only ever needs to change in one place.
 */
const SECTION = 'pollard';

export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

const DEFAULT_CACHE_TTL_MINUTES = 30;
const DEFAULT_MINIMUM_SCORE_FOR_BULK_DELETE = 95;
const DEFAULT_LOG_LEVEL: LogLevel = 'info';
const DEFAULT_AUTO_SCAN_ON_STARTUP = false;
const DEFAULT_AUTO_SCAN_INTERVAL_MINUTES = 0;
const DEFAULT_BACKUPS_RETENTION_DAYS = 90;

/**
 * resourcePath is a plain filesystem path (e.g. RepoHandle.rootPath), not a
 * vscode.Uri — so resource-scoped getters below don't force callers that
 * otherwise have no reason to import vscode (git/branch-facts.ts) into
 * constructing a Uri.file(...) wrapper just to make a config call. This
 * function does that conversion internally.
 */
function configFor(resourcePath?: string): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(
    SECTION,
    resourcePath ? vscode.Uri.file(resourcePath) : undefined
  );
}

// ---------------------------------------------------------------------------
// Protected branches (resource-scoped: pollard.protectedBranches,
// pollard.protectedBranches.replaceDefaults)
// ---------------------------------------------------------------------------

/**
 * Resolves pollard.protectedBranches + pollard.protectedBranches.replaceDefaults
 * into one final, deduplicated glob-pattern list. See
 * git/protected-branches.ts for the merge algorithm itself (kept pure there
 * for unit testing without a vscode host).
 */
export function getProtectedBranchPatterns(resourcePath?: string): string[] {
  const config = configFor(resourcePath);
  const userPatterns = config.get<string[]>('protectedBranches', [
    ...DEFAULT_PROTECTED_BRANCH_PATTERNS,
  ]);
  const replaceDefaults = config.get<boolean>('protectedBranches.replaceDefaults', false);
  return resolveProtectedBranchPatterns(userPatterns, replaceDefaults);
}

/**
 * Convenience yes/no wrapper for callers that just want one answer for one
 * branch. NOTE: git/branch-facts.ts — the original motivating caller — does
 * NOT use this. It resolves the pattern list once per repo (via
 * getProtectedBranchPatterns, called by its caller in scan.ts/refresh.ts)
 * and matches every branch against that one list itself using the pure
 * matchesAnyPattern from git/protected-branches.ts. That's both cheaper
 * (one config read per repo instead of per branch) and keeps
 * branch-facts.ts free of any dependency on this file. This function
 * remains here for other, simpler call sites.
 */
export function isProtectedBranchName(branchName: string, resourcePath?: string): boolean {
  return matchesAnyPattern(branchName, getProtectedBranchPatterns(resourcePath));
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

/** Window-scoped: a personal QuickPick pre-selection preference, not a repo policy. */
export function getMinimumScoreForBulkDelete(): number {
  return configFor().get<number>(
    'minimumScoreForBulkDelete',
    DEFAULT_MINIMUM_SCORE_FOR_BULK_DELETE
  );
}

/** Resource-scoped. Bare hostname (e.g. "gitlab.mycompany.com"); undefined means "gitlab.com only". */
export function getGitLabHost(resourcePath?: string): string | undefined {
  const host = configFor(resourcePath).get<string>('gitlabHost', '').trim().toLowerCase();
  return host.length > 0 ? host : undefined;
}

/** Resource-scoped. Stays nested under pollard.github.* — not renamed to match gitlabHost's flat naming (out of scope). */
export function getGitHubEnterpriseHost(resourcePath?: string): string | undefined {
  const host = configFor(resourcePath)
    .get<string>('github.enterpriseHost', '')
    .trim()
    .toLowerCase();
  return host.length > 0 ? host : undefined;
}

/** Window-scoped. Replaces the old pollard.cache.ttlMinutes key. */
export function getCacheTtlMinutes(): number {
  return configFor().get<number>('cacheTtlMinutes', DEFAULT_CACHE_TTL_MINUTES);
}

/** Window-scoped. No consumer yet — nothing in this codebase logs today; ready for a future diagnostics channel. */
export function getLogLevel(): LogLevel {
  return configFor().get<LogLevel>('logLevel', DEFAULT_LOG_LEVEL);
}

export function getAutoScanOnStartup(): boolean {
  return configFor().get<boolean>('autoScanOnStartup', DEFAULT_AUTO_SCAN_ON_STARTUP);
}

export function getAutoScanIntervalMinutes(): number {
  return configFor().get<number>('autoScanIntervalMinutes', DEFAULT_AUTO_SCAN_INTERVAL_MINUTES);
}

export function getBackupsRetentionDays(): number {
  return configFor().get<number>('backups.retentionDays', DEFAULT_BACKUPS_RETENTION_DAYS);
}
