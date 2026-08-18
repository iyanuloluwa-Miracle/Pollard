# Pollard

[![CI](https://github.com/iyanuloluwa-Miracle/Pollard/actions/workflows/ci.yml/badge.svg)](https://github.com/iyanuloluwa-Miracle/Pollard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Old branches pile up because deleting one feels risky and checking it by
hand is tedious. Pollard checks every local branch against your GitHub or
GitLab remote, tells you exactly why it's safe (or isn't) to delete, and
backs it up before it ever touches one — so cleanup stops being a thing you
put off.

<!--
TODO(release): record a short screen capture of Scan → Clean → Restore
(a few branches getting scanned, previewed, deleted, then one restored)
and save it as media/demo.gif, then replace this comment with:
![Pollard: scan, clean, and restore a branch](media/demo.gif)
Left as a placeholder rather than a fabricated screenshot — it needs a
real VS Code session against real repositories to be honest.
-->

## What it does

- **Scan** every local branch against GitHub/GitLab pull request status and
  local git history, and score how safe each one is to delete.
- **Clean** — preview exactly what will be deleted, confirm once, and
  delete one or many branches at a time.
- **Restore** — every deletion is backed up first. Nothing is ever
  permanently lost until you explicitly prune old backups.
- Works with GitHub, GitHub Enterprise Server, GitLab, and self-hosted
  GitLab — or with no remote at all, using local git history only.

## How Pollard decides

Every branch's score comes from two independent signals, combined:

1. **Local git facts** — is this branch's tip reachable from your default
   branch (merged)? Is it pushed to a remote (backed up off this machine)?
   Computed straight from git, no network needed.
2. **Pull/merge request status** — if you've connected GitHub or GitLab,
   Pollard looks up whether an associated PR/MR was merged, closed, or is
   still open. Batched into as few API calls as possible and cached, so
   re-scanning is fast and cheap. This step is entirely optional — Pollard
   works without signing in, just with less precision on branches that were
   squash-merged or rebased (git alone can't prove that locally).

Those two signals combine into a status and a 0–100 score:

| Status               | Score | Meaning                                                                                    |
| -------------------- | :---: | ------------------------------------------------------------------------------------------ |
| `SAFE_MERGED`        |  100  | Fully merged into the default branch — its commits are directly reachable.                 |
| `SAFE_SQUASH_MERGED` |  95   | Its pull/merge request was merged, but the commits aren't reachable (squashed or rebased). |
| `WARNING_CLOSED_PR`  |  60   | Its pull/merge request was closed **without** merging.                                     |
| `WARNING_UNMERGED`   |  35   | Its pull/merge request is still open — or see the local-only cap below.                    |
| `WARNING_NO_PR`      |  30   | Not merged, and no pull/merge request was found for it.                                    |
| `UNKNOWN`            |   0   | Merge status couldn't be determined (e.g. a shallow clone) and no PR/MR was found.         |
| `PROTECTED`          |   0   | Matches a protected branch pattern, or is your default branch.                             |
| `CURRENT`            |   0   | The branch you currently have checked out.                                                 |

**The local-only cap**: a branch whose commits exist _only on this
machine_ — not merged, not pushed to any remote — is capped at score 35
regardless of what PR data claims. A pull request that says "merged" is
only a real safety net once that content is actually backed up somewhere
other than your laptop.

## What Pollard never deletes

- **The branch you're currently on.** Always scored `CURRENT` / 0.
- **Protected branches.** `main`, `master`, `develop`, `dev`, `staging`,
  `release/*`, and `hotfix/*` are protected by default (glob-matched, and
  `release/*` also matches nested paths like `release/2.0/hotfix`) — add
  your own via `pollard.protectedBranches`, merged with the defaults unless
  you opt out.
- **Anything without your explicit confirmation.** Pollard always shows a
  preview and requires a confirmation click. It never deletes silently,
  automatically, or on a schedule.
- **Anything permanently, ever, at delete-time.** Every branch Pollard
  deletes is backed up first to a real git ref under
  `refs/pollard/backups/<branch>/<timestamp>` — refs there are immune to
  `git gc`. Recover any of them with **Pollard: Restore**. Backups are only
  ever removed by **Pollard: Prune Backups**, which you run explicitly and
  which asks for confirmation with an exact count before deleting anything.

## Commands

| Command                     | What it does                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **Pollard: Scan**           | Assess every branch against local git history + GitHub/GitLab.                       |
| **Pollard: Refresh**        | Re-assess using only local git history and already-cached PR data — no network call. |
| **Pollard: Clean**          | Preview, confirm, and delete selected branches (always backed up first).             |
| **Pollard: Restore**        | Recover a previously deleted branch from its backup ref.                             |
| **Pollard: Prune Backups**  | Delete backup refs older than the retention period, after confirming.                |
| **Pollard: Connect GitHub** | Sign in via VS Code's built-in GitHub authentication.                                |
| **Pollard: Connect GitLab** | Store a GitLab personal access token (`read_api` scope) in SecretStorage.            |
| **Pollard: Clear Cache**    | Discard cached pull/merge request lookups.                                           |

## Settings

All settings live under `pollard.*`.

| Setting                                     | Default                                                              | Description                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pollard.protectedBranches`                 | `["main","master","develop","dev","staging","release/*","hotfix/*"]` | Glob patterns for branches Pollard will never offer to delete. Merged with the defaults unless `replaceDefaults` is set. |
| `pollard.protectedBranches.replaceDefaults` | `false`                                                              | When `true`, your patterns replace the defaults instead of merging with them.                                            |
| `pollard.minimumScoreForBulkDelete`         | `95`                                                                 | Minimum score pre-checked by default in the Clean selection list.                                                        |
| `pollard.gitlabHost`                        | `""`                                                                 | Hostname of a self-hosted GitLab instance (leave empty for gitlab.com only).                                             |
| `pollard.github.enterpriseHost`             | `""`                                                                 | Hostname of a GitHub Enterprise Server instance (leave empty for github.com only).                                       |
| `pollard.cacheTtlMinutes`                   | `30`                                                                 | How long cached PR/MR lookups stay valid before Scan re-fetches them.                                                    |
| `pollard.logLevel`                          | `"info"`                                                             | Minimum severity written to the "Pollard" Output channel.                                                                |
| `pollard.autoScanOnStartup`                 | `false`                                                              | Automatically run Scan when a workspace with a git repository opens. Off by default.                                     |
| `pollard.autoScanIntervalMinutes`           | `0`                                                                  | Automatically re-run Scan on this interval. `0` disables it (default).                                                   |
| `pollard.backups.retentionDays`             | `90`                                                                 | How long backup refs are kept before **Pollard: Prune Backups** can remove them.                                         |

## Logging

Diagnostics go to the "Pollard" Output channel (View → Output → Pollard). It's
a log output channel with VS Code's native level picker — use the gear icon
in the Output panel to set it to Debug for maximum detail, Off to silence it,
or leave it at the default. Raw error messages and stack traces are only ever
written here, never shown in a notification popup.

## Telemetry

Pollard records only command names and error categories (e.g. `pollard.scan`
/ `rateLimited`) when something goes wrong — never branch names, repository
names, file paths, or remote URLs. In this build telemetry never leaves your
machine: it's written to the same "Pollard" Output channel instead of being
sent to an external endpoint, since no telemetry backend exists for this
project. It still goes through VS Code's real telemetry API, so it respects
the global `telemetry.telemetryLevel` setting and is disabled automatically
whenever you've opted out.

## Development

```sh
npm install
npm run watch
```

Then press F5 in VS Code to launch the Extension Development Host.

```sh
npm test              # vitest: safety engine, remote-URL parsing, providers
npm run test:vscode   # @vscode/test-cli: integration + end-to-end (real git repos)
npm run lint
npm run check-types
```

## License

[MIT](LICENSE)
