import * as vscode from 'vscode';
import { PollardLogger } from './logger';
import { formatRelativeDate } from './util';

/**
 * Single classification + presentation pathway for every fallible operation
 * in Pollard. Two shapes converge on one ClassifiedError: something thrown
 * deep in a fallible call is turned into one via classifyError(err), while a
 * proactive state check with no exception involved builds the same shape
 * directly via one of the classifyX(...) helpers below.
 */

export type ErrorCategory =
  | 'gitNotFound'
  | 'gitTimeout'
  | 'notAGitRepo'
  | 'detachedHead'
  | 'noRemote'
  | 'unrecognisedHost'
  | 'notSignedIn'
  | 'insufficientScope'
  | 'rateLimited'
  | 'offline'
  | 'unknown';

/** 'silent' = still logged and telemetried, never a popup — for conditions that would be obnoxious to nag about on every scan. */
export type ErrorSeverity = 'silent' | 'info' | 'warning' | 'error';

export interface ErrorAction {
  title: string;
  run: () => void | Promise<void>;
}

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  severity: ErrorSeverity;
  actions: ErrorAction[];
  cause?: unknown;
}

export type PollardCommandId =
  | 'pollard.scan'
  | 'pollard.clean'
  | 'pollard.restore'
  | 'pollard.refresh'
  | 'pollard.connectGithub'
  | 'pollard.connectGitlab'
  | 'pollard.clearCache'
  | 'pollard.deleteBranch'
  | 'pollard.pruneBackups';

/** Records only a command name and an error category — never branch names, repo names, or remote URLs. */
export interface TelemetryReporter {
  recordCommandError(command: PollardCommandId, category: ErrorCategory): void;
}

export interface PresentErrorContext {
  logChannel: PollardLogger;
  telemetry: TelemetryReporter;
  command: PollardCommandId;
}

// ---------------------------------------------------------------------------
// Error classes. AuthRequiredError/RateLimitedError moved here verbatim from
// the now-deleted src/providers/errors.ts.
// ---------------------------------------------------------------------------

export class AuthRequiredError extends Error {
  constructor(public readonly providerId: 'github' | 'gitlab') {
    super(`${providerId} requires authentication`);
    this.name = 'AuthRequiredError';
  }
}

export class RateLimitedError extends Error {
  constructor(public readonly resetAt: Date | null) {
    super('Provider is rate limited');
    this.name = 'RateLimitedError';
  }
}

export class InsufficientScopeError extends Error {
  constructor(public readonly providerId: 'github' | 'gitlab') {
    super(`${providerId} token lacks the scope required for this request`);
    this.name = 'InsufficientScopeError';
  }
}

export class OfflineError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Network request failed — appears to be offline', options);
    this.name = 'OfflineError';
  }
}

export class GitNotFoundError extends Error {
  constructor(
    public readonly gitPath: string,
    options?: { cause?: unknown }
  ) {
    super(`git executable not found: ${gitPath}`, options);
    this.name = 'GitNotFoundError';
  }
}

export class GitCommandTimeoutError extends Error {
  constructor(
    public readonly gitSubcommand: string,
    public readonly timeoutMs: number,
    options?: { cause?: unknown }
  ) {
    super(`git ${gitSubcommand} timed out after ${timeoutMs}ms`, options);
    this.name = 'GitCommandTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function signInAction(providerId: 'github' | 'gitlab'): ErrorAction {
  const commandId: PollardCommandId =
    providerId === 'github' ? 'pollard.connectGithub' : 'pollard.connectGitlab';
  return {
    title: providerId === 'github' ? 'Sign in to GitHub' : 'Sign in to GitLab',
    run: async () => {
      await vscode.commands.executeCommand(commandId);
    },
  };
}

/** Total — never throws. Anything not recognised falls back to 'unknown' rather than a confidently-wrong category. */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof GitNotFoundError) {
    return {
      category: 'gitNotFound',
      message:
        'Pollard could not find the git executable. Make sure Git is installed and on your PATH.',
      severity: 'error',
      actions: [],
      cause: err,
    };
  }
  if (err instanceof GitCommandTimeoutError) {
    return {
      category: 'gitTimeout',
      message: `Pollard: git ${err.gitSubcommand} timed out. The repository may be very large or on a slow filesystem.`,
      severity: 'error',
      actions: [],
      cause: err,
    };
  }
  if (err instanceof AuthRequiredError) {
    return classifyNotSignedIn(new Set([err.providerId]));
  }
  if (err instanceof InsufficientScopeError) {
    const name = err.providerId === 'github' ? 'GitHub' : 'GitLab';
    return {
      category: 'insufficientScope',
      message: `Pollard: Your ${name} token doesn't have the scope needed to read pull/merge requests.`,
      severity: 'warning',
      actions: [],
      cause: err,
    };
  }
  if (err instanceof RateLimitedError) {
    const resetText = err.resetAt ? ` Resets ${formatRelativeDate(err.resetAt)}.` : '';
    return {
      category: 'rateLimited',
      message: `Pollard: Rate limit reached — showing local + cached results only.${resetText}`,
      severity: 'warning',
      actions: [],
      cause: err,
    };
  }
  if (err instanceof OfflineError) {
    return {
      category: 'offline',
      message: 'Pollard: Appears to be offline — showing cached results only.',
      severity: 'silent',
      actions: [],
      cause: err,
    };
  }
  return {
    category: 'unknown',
    message: `Pollard: An unexpected error occurred${err instanceof Error ? `: ${err.message}` : ''}.`,
    severity: 'error',
    actions: [],
    cause: err,
  };
}

export function classifyNotAGitRepo(): ClassifiedError {
  return {
    category: 'notAGitRepo',
    message: 'Pollard: No Git repository found in this workspace.',
    severity: 'info',
    actions: [],
  };
}

export function classifyDetachedHead(repoLabel: string): ClassifiedError {
  return {
    category: 'detachedHead',
    message: `Pollard: ${repoLabel} is in a detached HEAD state — no current branch to protect from deletion.`,
    severity: 'info',
    actions: [],
  };
}

export function classifyNoRemote(repoLabel: string): ClassifiedError {
  return {
    category: 'noRemote',
    message: `Pollard: ${repoLabel} has no remote configured — showing local branch status only.`,
    severity: 'silent',
    actions: [],
  };
}

export function classifyUnrecognisedHost(repoLabel: string, host: string): ClassifiedError {
  return {
    category: 'unrecognisedHost',
    message: `Pollard: ${repoLabel}'s remote host "${host}" isn't recognised as GitHub or GitLab — showing local branch status only.`,
    severity: 'silent',
    actions: [],
  };
}

export function classifyNotSignedIn(
  providerIds: ReadonlySet<'github' | 'gitlab'>
): ClassifiedError {
  const names = [...providerIds].map((p) => (p === 'github' ? 'GitHub' : 'GitLab'));
  return {
    category: 'notSignedIn',
    message: `Pollard: Sign in to ${names.join(' and ')} to check pull request status.`,
    severity: 'warning',
    actions: [...providerIds].map(signInAction),
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function logClassifiedError(
  logChannel: PollardLogger,
  classified: ClassifiedError
): void {
  const line = `[${classified.category}] ${classified.message}`;
  switch (classified.severity) {
    case 'error':
      logChannel.error(line);
      break;
    case 'warning':
      logChannel.warn(line);
      break;
    default:
      logChannel.info(line);
      break;
  }
  // Raw errors and stack traces go to the channel only — never into a notification.
  if (classified.cause instanceof Error) {
    logChannel.error(classified.cause.stack ?? classified.cause.message);
  } else if (classified.cause !== undefined) {
    logChannel.error(String(classified.cause));
  }
}

/** Logs + records telemetry, without ever showing a notification — for per-item failures inside a batch operation that already surfaces its own aggregate summary. */
export function logAndTrackError(classified: ClassifiedError, ctx: PresentErrorContext): void {
  logClassifiedError(ctx.logChannel, classified);
  ctx.telemetry.recordCommandError(ctx.command, classified.category);
}

/** Logs, records telemetry, then shows a notification unless severity === 'silent'. */
export function presentError(classified: ClassifiedError, ctx: PresentErrorContext): void {
  logAndTrackError(classified, ctx);
  if (classified.severity === 'silent') return;

  const buttons = classified.actions.map((a) => a.title);
  const handleChoice = (choice: string | undefined): void => {
    const action = classified.actions.find((a) => a.title === choice);
    void action?.run();
  };

  if (classified.severity === 'error') {
    void vscode.window.showErrorMessage(classified.message, ...buttons).then(handleChoice);
  } else if (classified.severity === 'warning') {
    void vscode.window.showWarningMessage(classified.message, ...buttons).then(handleChoice);
  } else {
    void vscode.window.showInformationMessage(classified.message, ...buttons).then(handleChoice);
  }
}
