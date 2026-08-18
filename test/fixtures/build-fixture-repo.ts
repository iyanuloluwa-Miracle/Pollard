import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Builds a real temp git repo (+ a local bare "remote", no network needed)
 * with fixture branches exercising every merge/push shape computeLocalBranchFacts
 * and assessBranchSafety need to distinguish. Rebuilt from scratch on every
 * run (hermetic — no stale branches bleeding between local runs). Must
 * finish BEFORE @vscode/test-cli launches the Extension Development Host,
 * since workspaceFolder in .vscode-test.mjs is a launch argument pointing
 * at FIXTURE_DIR — see package.json's pretest:vscode script.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..'); // out/test/fixtures -> repo root
export const FIXTURE_DIR = path.join(ROOT, '.test-fixtures', 'integration-repo');
const REMOTE_DIR = path.join(ROOT, '.test-fixtures', 'integration-remote.git');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeFileCommit(
  repoDir: string,
  filename: string,
  content: string,
  message: string
): void {
  fs.writeFileSync(path.join(repoDir, filename), content);
  git(repoDir, 'add', filename);
  git(repoDir, 'commit', '-m', message);
}

export function buildFixtureRepo(): string {
  const containerDir = path.dirname(FIXTURE_DIR);
  fs.rmSync(containerDir, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.mkdirSync(REMOTE_DIR, { recursive: true });
  git(REMOTE_DIR, 'init', '--bare', '-b', 'main');

  git(FIXTURE_DIR, 'init', '-b', 'main');
  git(FIXTURE_DIR, 'config', 'user.email', 'pollard-test@example.com');
  git(FIXTURE_DIR, 'config', 'user.name', 'Pollard Test');
  git(FIXTURE_DIR, 'remote', 'add', 'origin', REMOTE_DIR);
  writeFileCommit(FIXTURE_DIR, 'README.md', '# fixture\n', 'initial commit');
  git(FIXTURE_DIR, 'push', 'origin', 'main');

  // feature/merged — real merge back into main, tip reachable from default.
  git(FIXTURE_DIR, 'checkout', '-b', 'feature/merged', 'main');
  writeFileCommit(FIXTURE_DIR, 'merged.txt', 'merged\n', 'feature/merged commit');
  git(FIXTURE_DIR, 'checkout', 'main');
  git(FIXTURE_DIR, 'merge', '--no-ff', 'feature/merged', '-m', 'Merge feature/merged');
  git(FIXTURE_DIR, 'push', 'origin', 'main');

  // feature/squashed — pushed, but main gets an equivalent NEW commit
  // (simulating a GitHub squash-merge), so the original tip stays unreachable.
  git(FIXTURE_DIR, 'checkout', '-b', 'feature/squashed', 'main');
  writeFileCommit(FIXTURE_DIR, 'squashed.txt', 'squashed\n', 'feature/squashed commit');
  git(FIXTURE_DIR, 'push', 'origin', 'feature/squashed');
  git(FIXTURE_DIR, 'checkout', 'main');
  writeFileCommit(FIXTURE_DIR, 'squashed.txt', 'squashed\n', 'Squash-merge feature/squashed (#1)');
  git(FIXTURE_DIR, 'push', 'origin', 'main');

  // feature/rebased — pushed, then locally rewritten without re-pushing:
  // existsOnRemote stays true (stale tracking ref), isPushed becomes false.
  git(FIXTURE_DIR, 'checkout', '-b', 'feature/rebased', 'main');
  writeFileCommit(FIXTURE_DIR, 'rebased.txt', 'rebased v1\n', 'feature/rebased commit');
  git(FIXTURE_DIR, 'push', 'origin', 'feature/rebased');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'rebased.txt'), 'rebased v2\n');
  git(FIXTURE_DIR, 'add', 'rebased.txt');
  git(FIXTURE_DIR, 'commit', '--amend', '-m', 'feature/rebased commit (rewritten)');
  // deliberately not pushed again

  // feature/force-pushed — same push-then-rewrite-without-repush shape;
  // the test attaches a fake merged PR to exercise the local-only cap.
  git(FIXTURE_DIR, 'checkout', '-b', 'feature/force-pushed', 'main');
  writeFileCommit(FIXTURE_DIR, 'force-pushed.txt', 'v1\n', 'feature/force-pushed commit');
  git(FIXTURE_DIR, 'push', 'origin', 'feature/force-pushed');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'force-pushed.txt'), 'v2\n');
  git(FIXTURE_DIR, 'add', 'force-pushed.txt');
  git(FIXTURE_DIR, 'commit', '--amend', '-m', 'feature/force-pushed commit (rewritten)');
  // deliberately not re-pushed

  // feature/unpushed — local only, never touches origin.
  git(FIXTURE_DIR, 'checkout', '-b', 'feature/unpushed', 'main');
  writeFileCommit(FIXTURE_DIR, 'unpushed.txt', 'unpushed\n', 'feature/unpushed commit');

  // feature/for-deletion — layer 4 (e2e) only, untouched by any layer-3 assertion.
  git(FIXTURE_DIR, 'checkout', '-b', 'feature/for-deletion', 'main');
  writeFileCommit(FIXTURE_DIR, 'for-deletion.txt', 'delete me\n', 'feature/for-deletion commit');

  git(FIXTURE_DIR, 'checkout', 'main');
  return FIXTURE_DIR;
}

if (require.main === module) {
  const dir = buildFixtureRepo();
  console.log(`Fixture repo built at ${dir}`);
}
