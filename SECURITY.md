# Security Policy

## Supported Versions

Pollard is pre-1.0 and ships a single rolling release. Security fixes land
in the latest published version — there are no parallel maintained release
branches.

| Version | Supported |
| ------- | --------- |
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting:
[github.com/iyanuloluwa-Miracle/Pollard/security/advisories/new](https://github.com/iyanuloluwa-Miracle/Pollard/security/advisories/new).
This opens a private advisory visible only to the maintainer until a fix is
ready, and lets you coordinate disclosure timing.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal repository/workspace setup, if relevant).
- The Pollard version and VS Code version you tested against.

We'll acknowledge new reports as quickly as we can and aim to keep you
updated as a fix is developed.

## Scope

Pollard's authentication tokens (GitHub session, GitLab personal access
token) are stored exclusively via VS Code's `SecretStorage` API — never in
settings, never in plaintext on disk, and never transmitted anywhere except
directly to the GitHub/GitLab host they authenticate against. Telemetry (see
the README's Telemetry section) never leaves your machine and never
includes branch names, repository names, or remote URLs. If a report
involves either of these guarantees appearing to fail, please flag that
explicitly — it would be treated as high severity.
