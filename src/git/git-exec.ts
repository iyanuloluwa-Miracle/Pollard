import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    // Node attaches stdout/stderr to the rejected error on a non-zero exit
    // for execFile (independent of promisify); spawn failures (e.g. ENOENT
    // if the 'git' PATH fallback isn't resolvable) won't have stderr, so
    // fall back to the error message.
    throw new Error(`git ${args[0]} failed: ${e.stderr?.trim() || e.message}`, { cause: err });
  }
}
