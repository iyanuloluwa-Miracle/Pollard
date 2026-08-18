import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitCommandTimeoutError, GitNotFoundError } from '../errors';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 20_000;

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a git plumbing command against an explicit --git-dir — never depends
 * on cwd or a checked-out worktree, so callers should pass the repo's
 * commonDir (shared across worktrees). Array-form execFile args only, no
 * shell string is ever built, so branch names or messages containing any
 * characters are inherently safe from injection.
 */
export async function runGit(
  gitPath: string,
  gitDir: string,
  args: string[]
): Promise<GitExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(gitPath, ['--git-dir', gitDir, ...args], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (e.code === 'ENOENT') {
      throw new GitNotFoundError(gitPath, { cause: err });
    }
    if (e.killed) {
      throw new GitCommandTimeoutError(args[0], GIT_TIMEOUT_MS, { cause: err });
    }
    // Node attaches stdout/stderr to the rejected error on a non-zero exit
    // for execFile (independent of promisify); other spawn failures won't
    // have stderr, so fall back to the error message.
    throw new Error(`git ${args[0]} failed: ${e.stderr?.trim() || e.message}`, { cause: err });
  }
}
