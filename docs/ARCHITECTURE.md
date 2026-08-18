# Architecture

This is the target (and, as of this restructuring, actual) layout of `src/`, and the rules that keep it that way.

## Layout

```
src/
├── extension.ts        activate()/deactivate() + DI wiring only
├── config.ts            sole vscode.workspace.getConfiguration('pollard') reader
├── errors.ts             error classes, classification, presentation
├── logger.ts             PollardLogger — LogOutputChannel facade + ring buffer
├── telemetry.ts          PollardTelemetryReporter
├── commands/              one file per pollard.* command, index.ts registers them all
│   ├── index.ts             registerCommands(context, deps)
│   ├── types.ts              ScanDeps (shared command DI shape)
│   ├── scan.ts / clean.ts / restore.ts / refresh.ts
│   ├── clearCache.ts / pruneBackups.ts / doctor.ts
│   └── index.ts is also this directory's barrel
├── git/                    pure git plumbing — no vscode import except where noted
│   ├── exec.ts               spawn wrapper, timeouts, git --version (no vscode import)
│   ├── branches.ts            for-each-ref parsing, default-branch resolution
│   ├── merge.ts                merged / squash-merged / ancestor checks
│   ├── backup.ts                update-ref backup + restore
│   ├── types.ts                 vendored vscode.git API types + ref-type constants
│   └── index.ts                 barrel
├── workspace/
│   ├── repositories.ts    RepoRegistry — the only vscode.git-API-aware git-adjacent file
│   └── index.ts
├── providers/
│   ├── provider.ts          Provider interface, createProvider factory, rate-limit registry
│   ├── remoteUrl.ts          ssh/https/enterprise URL parsing
│   ├── rateLimit.ts           RateLimiter
│   ├── http.ts                 fetchJson wrapper
│   ├── noop.ts                  NoopProvider
│   ├── github/ {client,graphql,auth}.ts + index.ts
│   ├── gitlab/ {client,auth}.ts + index.ts
│   └── index.ts
├── safety/
│   ├── types.ts             BranchFacts, SafetyStatus, SafetyAssessment, BranchAssessment
│   ├── engine.ts              assessBranchSafety + per-repo assessment building — zero vscode import, zero I/O
│   ├── status.ts               SafetyStatus -> bucket/icon/color mapping
│   ├── protected.ts             protected-branch glob matching (pure)
│   └── index.ts
├── state/
│   ├── cache.ts             RepoCache (runtime: reads/writes via vscode.workspace.fs)
│   ├── schema.ts             cache file schema + migration (pure)
│   └── index.ts
├── views/
│   ├── branchTree.ts        BranchTreeProvider (TreeDataProvider)
│   ├── items.ts               BranchTreeElement + element constructors (pure)
│   ├── statusBar.ts            StatusBarController
│   ├── previewDocument.ts       clean-preview TextDocumentContentProvider
│   └── index.ts
├── ui/
│   ├── quickPick.ts         pickRepo
│   ├── confirm.ts             confirmDeletion, confirmRestoreAsRenamed
│   └── index.ts
└── util/
    ├── concurrency.ts        mapWithConcurrency
    ├── relative-time.ts       formatRelativeDate
    └── index.ts
```

`scripts/` (repo root, alongside `src/`) holds build/dev tooling excluded from the packaged VSIX: `esbuild.mjs` (the bundler) and `check-contributions.mjs` (see below).

## Layer boundaries (enforced, not just documented)

`eslint.config.mjs` fails `npm run lint` — a hard step in `npm run check` and CI — on:

- Any `vscode` import inside `src/safety/**` or `src/git/exec.ts`.
- Any import from `views/` or `providers/` inside `src/git/**`.
- Any import from `views/` inside `src/providers/**`.

This is why `git/branches.ts` doesn't parse remote URLs itself (`primaryRemoteFetchUrl`/`resolvePrimaryParsedRemote` live in `providers/remoteUrl.ts` instead, since they produce a providers-domain `ParsedRemote`), and why `views/branchTree.ts`'s status→bucket/icon/color mapping lives in `safety/status.ts` instead — both were real violations the ESLint rules caught while this restructuring was in progress, not hypothetical ones.

## Barrels

Every directory listed above has an `index.ts` re-exporting only the symbols other directories actually import from it. Cross-directory imports go through the barrel (`import { RepoRegistry } from '../workspace'`), not a deep file path (`'../workspace/repositories'`). Imports that stay *within* one layer — e.g. `providers/github/client.ts` reaching into its own parent `providers/` for `rateLimit.ts`, which nothing outside `providers/` needs — are exempt; the barrel rule is about the boundaries between layers, not every nested folder.

## `scripts/check-contributions.mjs`

Cross-checks `package.json`'s `contributes.commands`/`contributes.views` against every `registerCommand`/`registerTreeDataProvider` call under `src/`, and fails (`process.exit(1)`) on any mismatch in either direction. Run via `npm run check-contributions`, folded into `npm run check`, and its own step in CI.

## Where a new `SafetyStatus` goes

See `CONTRIBUTING.md` — `safety/types.ts` → `safety/status.ts` → `safety/engine.ts` → a test in `safety/engine.test.ts`, in that order.
