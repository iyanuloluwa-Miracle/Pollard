# Contributing to Pollard

## Prerequisites

- Node.js 22 (matches CI — see `.github/workflows/ci.yml`)
- VS Code `^1.85.0` or later
- Git

## Getting set up

```
npm ci
```

## Running the extension (F5)

Press **F5** (or Run and Debug → **Run Extension**) to launch a new VS Code window with Pollard loaded from source. This uses the `Run Extension` configuration in `.vscode/launch.json`, which builds via the default build task (`npm run compile`, via `scripts/esbuild.mjs`) before launching, then attaches the debugger to the Extension Development Host.

Open a folder containing a git repository in that new window to see Pollard's tree view (`pollard.branches`) activate.

## Before committing: `npm run check`

```
npm run check
```

Runs, in order:

1. `lint` — ESLint over `src/`, `test/`, and `scripts/`. Includes the layering rules in `eslint.config.mjs` (`safety/` and `git/exec.ts` may not import `vscode`; `git/` may not import from `views/` or `providers/`; `providers/` may not import from `views/`) — these are `error` severity, so a violation fails this step, not just warns.
2. `check-types` — `tsc --noEmit`.
3. `check-contributions` — `scripts/check-contributions.mjs` cross-checks every command/view id declared in `package.json`'s `contributes` against every `registerCommand`/`registerTreeDataProvider` call in `src/`, failing if either side has an entry the other doesn't.

Also run the test suite:

```
npm test
```

(`vitest`, covers everything under `src/**/*.test.ts` — pure logic, no VS Code API). `npm run test:integration` / `npm run test:e2e` additionally exercise real git repos through the `@vscode/test-cli` Extension Development Host; see `test/` for fixtures.

## Adding a new `SafetyStatus`

A `SafetyStatus` touches three files, in this order:

1. **`src/safety/types.ts`** — add the new literal to the `SafetyStatus` union.
2. **`src/safety/status.ts`** — add a case to the `STATUS_DISPLAY` table (bucket, icon, color) so the tree view and `statusToBucket`/`statusIconAndColor` know how to render it. TypeScript's exhaustiveness checking on this `Record<SafetyStatus, ...>` will fail to compile until you do.
3. **`src/safety/engine.ts`** — add the scoring logic in `computeBaseAssessment` (or wherever the new status should be assigned) that actually produces the new status.
4. **`src/safety/engine.test.ts`** — add a test case asserting the new status and its score for the facts shape that should produce it.

If the new status should ever be offered for bulk deletion, also add it to `DELETABLE_STATUSES` in `src/commands/clean.ts`, and keep the `view/item/context` `when`-clause regex in `package.json` in sync (a `when`-clause can't import a TS constant, so this one has to be kept manually consistent — see the comment above `DELETABLE_STATUSES`).

## Rule: any change touching `src/safety/**` needs a test

`src/safety/` is the one directory in this codebase with a hard architectural guarantee: zero `vscode` import, zero I/O (enforced by the ESLint rule above). That's what makes it possible to unit-test every scoring rule directly, with no Extension Development Host, no fixture repos, no mocking. Any change to a file under `src/safety/` — a new status, a changed score, a new scoring condition — must come with a new or updated test case in `src/safety/engine.test.ts` in the same commit. A safety-scoring change with no corresponding test is the one thing this codebase asks you not to skip.
