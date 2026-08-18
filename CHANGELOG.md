# Changelog

All notable changes to Pollard are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-root branch tree view (**Pollard: Branches**), grouping every local
  branch into Safe, Squash-merged, Warnings, Protected, or Not Yet Assessed.
- **Pollard: Scan** and **Pollard: Refresh** — combine local git history
  (merge/push status) with pull request status from GitHub or GitLab to
  assess every branch. Scan never runs automatically unless you opt in.
- **Pollard: Clean** — preview exactly what will be deleted, confirm once,
  and delete one or many branches at a time. Every deletion is backed up
  first under `refs/pollard/backups/`, which `git gc` never collects.
- **Pollard: Restore** — recover any branch Pollard has ever deleted, from
  its backup ref, with automatic name-collision handling.
- **Pollard: Prune Backups** — remove backup refs older than a configurable
  retention period (default 90 days). Only ever runs on explicit command.
- GitHub and GitLab support, including GitHub Enterprise Server and
  self-hosted GitLab instances.
- Status bar indicator showing how many branches are safe to delete right
  now; click it to re-scan.
- Full configuration surface: protected branch patterns (glob-matched,
  merged with sensible defaults), minimum score for bulk-delete
  pre-selection, GitLab/GitHub Enterprise hosts, PR-cache TTL, diagnostic
  log level, and opt-in auto-scan on startup or on an interval.
- Centralized diagnostics in a "Pollard" Output channel with VS Code's
  native per-channel log level picker — raw errors and stack traces never
  appear in a notification, only in the channel.
- Local-only telemetry: only a command name and an error category are ever
  recorded (never branch names, repository names, or remote URLs), and it
  never leaves your machine.
- Test suite covering unit tests for the safety engine and remote-URL
  parsing, provider tests against a mocked HTTP layer (including rate-limit
  and malformed-response handling), integration tests against real
  temporary git repositories, and an end-to-end delete-and-restore test.
- CI matrix across Ubuntu, macOS, and Windows on every pull request.

[Unreleased]: https://github.com/iyanuloluwa-Miracle/Pollard/commits/main
