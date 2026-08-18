# Pollard

Find, verify and safely delete dead Git branches.

## Development

```sh
npm install
npm run watch
```

Then press F5 in VS Code to launch the Extension Development Host.

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
