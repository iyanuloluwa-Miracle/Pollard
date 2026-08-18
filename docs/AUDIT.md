# Pollard Extension Audit

Audit date: 2026-08-18. Scope: the 10 checks below, covering contribution wiring, activation, disposables, async correctness, cancellation, config isolation, safety-engine purity, secrets handling, packaging, and test coverage.

**Note on `npm run check`:** at audit time no `check` script existed in `package.json` — CI and the README ran `npm run lint` and `npm run check-types` as two separate steps. A `check` script combining both was added as the first fix commit so verification commands in this document are literal. Both `lint` and `check-types` were clean (zero errors/warnings) at audit time and remain the baseline all fixes are verified against.

## Checks with no findings (PASS)

| # | Check | Result |
|---|---|---|
| 1 | Contribution wiring | PASS — all 9 `package.json` commands have exactly one matching `registerCommand` in `src/extension.ts:55-69` and vice versa; all menu/view `when`-clauses and the `pollard.branches` view id resolve correctly. |
| 2 | Activation | PASS — `activationEvents` is the single minimal `onView:pollard.branches` (`package.json:50`); matches `registerTreeDataProvider('pollard.branches', ...)` at `src/extension.ts:54` exactly. |
| 3 | Disposables | PASS — every listener/watcher/status-bar-item/output-channel/interval is pushed to `context.subscriptions` or disposed via an owning class's `dispose()` (e.g. `RepoRegistry.dispose()` in `src/git/repo-registry.ts:318-322`, `BranchTreeProvider.dispose()` in `src/views/branchTree.ts:238-241`). No leaks found. |
| 6 | Config isolation | PASS — only `src/config.ts:33` calls `vscode.workspace.getConfiguration`; all 10 declared settings keys are read exactly once, and vice versa. |
| 7 | Safety engine purity | PASS — `src/safety/engine.ts` has no `vscode` import and performs no I/O of any kind. |
| 8 | Secrets | PASS — GitHub token flows through the built-in Authentication API only; GitLab PAT is stored via `context.secrets` (`src/providers/gitlab/gitlab-auth.ts:9,24`) and never written to settings, logs, notifications, or the cache file (`src/state/cache.ts` explicitly excludes token fields). |
| 9 | Packaging | PASS — `.vscodeignore` excludes `src/**`, `test/**`, `node_modules/**`, `**/*.map`; no `files` override reintroduces them. |

## Findings

| # | Finding | Severity | File:line | Fix summary | Status |
|---|---|---|---|---|---|
| 1 | No test exercises any command by its registered id — all 9 commands in `src/extension.ts:55-69` (`pollard.scan`, `clean`, `restore`, `refresh`, `connectGithub`, `connectGitlab`, `clearCache`, `deleteBranch`, `pruneBackups`) have zero references to their command-id string anywhere in `test/**` or `src/**/*.test.ts`; existing tests call underlying logic functions directly, never `vscode.commands.executeCommand`. | Major | `src/extension.ts:55-69` | Add an integration test asserting `vscode.commands.getCommands(true)` contains all 9 ids. | Resolved — `test/integration/commands.test.ts` |
| 2 | Bulk-destructive flows have no cancellation once confirmed — the sequential per-branch delete loop (`src/clean/clean.ts:318-322`) and the sequential per-ref prune loop (`src/backup/prune.ts:69-86`) accept no `CancellationToken` and report no progress, so a large confirmed batch cannot be stopped partway through. | Major | `src/clean/clean.ts:318-322`, `src/backup/prune.ts:69-86` | Wrap both loops in `vscode.window.withProgress({cancellable: true})`, matching the existing pattern in `src/scan/scan.ts:49-54`, checking the token between iterations. | Resolved |
| 3 | 8 floating promises — `showInformationMessage` calls with no `await`/`void`, so any (currently unused) return value is silently discarded and the pattern is inconsistent with the codebase's own convention. | Minor | `src/clean/clean.ts:260,347,353,367`; `src/backup/prune.ts:52-53,95`; `src/backup/restore.ts:77,98` | Prefix each with `void`, matching the correct existing pattern at `src/errors.ts:288-292`. | Resolved |
| 4 | Scan Phase 2 doesn't short-circuit its per-repo loop on cancellation — only the network PR-fetch call is gated (`src/scan/scan.ts:124`); cache reads, provider construction, and auth-session lookups still run for every remaining repo after cancel. (Note: the cache-read-after-cancel behavior itself is intentional per the comment at `scan.ts:78-80` — only the redundant provider/auth work is the actual gap.) | Minor | `src/scan/scan.ts:88-148` | Add a token check after the cache-read block to skip provider/auth work once cancelled. | Open |
| 5 | Scan Phase 3 (assess) has no cancellation check at all — pure local computation over already-fetched data, so impact is low, but it's a multi-repo loop inside a `cancellable: true` progress dialog with no token check. | Minor | `src/scan/scan.ts:161-179` | Add a token check for consistency. | Open |
| 6 | `computeLocalBranchFacts` takes no `CancellationToken` — called from `scan.ts:70` inside a loop that only checks cancellation between repos (`scan.ts:65`), not during a single repo's computation; a repo with very large branch counts cannot be interrupted mid-repo. | Minor | `src/git/branch-facts.ts:150-193` | Thread `token` through to `mapWithConcurrency` and check it per-branch. | Open |

## Test coverage detail (check 10)

Every `SafetyStatus` value (`SAFE_MERGED`, `SAFE_SQUASH_MERGED`, `WARNING_CLOSED_PR`, `WARNING_UNMERGED`, `WARNING_NO_PR`, `PROTECTED`, `CURRENT`, `UNKNOWN` — `src/safety/engine.ts:29-37`) has at least one assertion in `src/safety/engine.test.ts` or `test/integration/assessments.test.ts` — no gap there. The only test-coverage gap is command-id-level coverage, captured as finding #1 above.
