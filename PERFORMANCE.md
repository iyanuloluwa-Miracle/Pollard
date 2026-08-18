# Performance

This document records the activation-cost audit performed on the extension
and the guarantees the code now enforces. Re-run the measurements below
after any change that touches `src/extension.ts`, `src/workspace/repositories.ts`,
or `src/git/branches.ts`.

## 1. `activate()` does no git or network work

`activate()` in `src/extension.ts` is limited to: creating the output
channel, the telemetry reporter, the tree/status-bar view models, and
registering commands/providers — all synchronous, in-memory operations.

The one thing that used to violate this was `RepoRegistry.create()`, which
previously activated the built-in `vscode.git` extension if needed, read
`.git`/`commondir` files for every open repo, and set up filesystem watchers
— all `await`ed directly inside `activate()`, so the extension host couldn't
report itself "active" until that finished.

`RepoRegistry.create()` (`src/workspace/repositories.ts`) is now **synchronous**:
it returns an instance immediately and kicks off that same enumeration in
the background via a private `initialize()` promise. Nothing in `activate()`
awaits it. Every read path that actually needs a populated repo list —
`BranchTreeProvider.getChildren` (now `async`), `pollard.scan`,
`pollard.refresh`, `pickRepo`, the inline delete command, and
`pollard.pruneBackups` — calls `await registry.whenReady()` first. In
practice this means the cost lands behind whichever happens first: the tree
view asking for its root children (the common case, since the activation
event is `onView:pollard.branches`) or the first command invocation. No
code path still blocks `activate()` on it.

Grep-verified: `RepoRegistry.create` has no `await` at its call site in
`src/extension.ts`, and `whenReady()` is awaited at the top of every other
entry point that reads `registry.repos`.

## 2. Measured activation time

`Developer: Show Running Extensions` requires a running VS Code window,
which this environment can't launch. Instead, `activate()` was measured by
loading the real production bundle (`dist/extension.js`) under Node with a
minimal `vscode` API stub and timing the call directly — this exercises the
actual shipped code path, not a re-implementation of it. The harness lives
outside the repo (it's a throwaway measurement tool, not part of the
extension) and stubs only what module-load-time code in the bundle touches
(`ThemeIcon`, `EventEmitter`, output channel, status bar item, command
registration, `workspace.getConfiguration`, etc.) plus `extensions.getExtension`
for two scenarios.

| Scenario                                  | `activate()` time (3 runs) |
| ----------------------------------------- | -------------------------- |
| No `vscode.git` extension found           | 2.44ms / 1.21ms / 1.53ms   |
| `vscode.git` present, 0 repositories open | 1.51ms / 2.29ms / 1.74ms   |

All runs are low-single-digit milliseconds — consistent with `activate()`
containing no blocking git or network call. `require(bundle)` (module
load/JIT, ~55–165ms across runs, dominated by Node cold-start variance) is
reported separately in the harness output since it isn't part of what
`activate()` itself does — this is closer to what VS Code's extension host
loading step covers, and it isn't materially affected by the changes in this
audit either way.

**Action for the reader**: run the extension via F5, open a real
multi-repo workspace, run `Developer: Show Running Extensions`, and record
the actual in-VS-Code number here — that's the authoritative figure; the
above is a code-path-accurate proxy, not a replacement for it.

## 3. Bundle size

`npm run package` (`node scripts/esbuild.mjs --production`, wired into
`vscode:prepublish`) produces the minified, sourcemap-free bundle actually
shipped. Previously `vscode:prepublish` ran plain `npm run compile`, which
skips minification and includes a sourcemap — the packaged `.vsix` would
have shipped an unminified dev build. Fixed by adding a dedicated `package`
script.

```
$ npm run package
$ ls -la dist/extension.js
49351 bytes  (~48KB)
```

48KB is well under the 500KB budget. There are zero runtime `dependencies`
in `package.json` (only `devDependencies`), which is the main reason the
bundle stays this small — there's no bundled SDK for GitHub/GitLab/telemetry,
all of it is hand-rolled against `fetch`.

## 4. Git subprocess concurrency is bounded, not unbounded or serial

`computeLocalBranchFacts` (`src/git/branches.ts`) is what fans out
per-branch git lookups (merge-base, push status, upstream-gone, ancestor
checks) via the `vscode.git` extension's own `Repository` methods. On a
200-branch repo this previously ran fully serially (each branch awaited
before starting the next — slow, but not a resource storm) and looked, at a
glance, like the kind of code that could regress into firing all N at once.

It now goes through `mapWithConcurrency` (`src/util/concurrency.ts`), a
small worker-pool helper with zero new dependencies, bounded to
`BRANCH_FACTS_CONCURRENCY = 4`. At most 4 branches' worth of git lookups are
in flight at once, regardless of whether the repo has 5 branches or 500.

```ts
const BRANCH_FACTS_CONCURRENCY = 4;
const entries = await mapWithConcurrency(
  repo.branches,
  BRANCH_FACTS_CONCURRENCY,
  async (branch) => {
    /* mergeStatus, isPushed, upstreamIsGone, isAncestorOfAnotherLocalBranch */
  }
);
```

`computeIsAncestorOfAnotherLocalBranch`'s own inner loop (up to 60 other
branches per branch) is unchanged — it's already capped at
`ANCESTOR_CHECK_MAX_BRANCHES = 60` and skipped entirely above that, so it
doesn't add to the "200 branches at once" risk this audit was concerned
with.

## Summary

| Requirement                                   | Status                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `activate()` does no git/network work         | ✅ `RepoRegistry.create()` is now synchronous; population deferred behind `whenReady()`                 |
| Everything lazy behind first tree render      | ✅ `BranchTreeProvider.getChildren` is the first `await`er of `registry.whenReady()`                    |
| Bundle under 500KB minified                   | ✅ 48KB (`npm run package`)                                                                             |
| Activation time recorded                      | ✅ proxy-measured (1–3ms); real in-VS-Code number still needs a manual F5 + Show Running Extensions run |
| Git subprocess calls bounded to concurrency 4 | ✅ `mapWithConcurrency` in `computeLocalBranchFacts`                                                    |
