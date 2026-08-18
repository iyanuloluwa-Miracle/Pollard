import * as vscode from 'vscode';
import { ErrorCategory, PollardCommandId, TelemetryReporter } from './errors';
import { PollardLogger } from './logger';

/**
 * Local-only stand-in: goes through the real vscode.env.createTelemetryLogger
 * API (so VS Code's global telemetry.telemetryLevel and the user's own
 * opt-out are honored exactly as they would be for a real sender), but the
 * sender writes to the Pollard output channel instead of transmitting
 * anywhere — no external endpoint exists for this project.
 */
export class PollardTelemetryReporter implements TelemetryReporter, vscode.Disposable {
  private readonly logger: vscode.TelemetryLogger;
  private readonly disposables: vscode.Disposable[] = [];
  private enabled: boolean;

  constructor(private readonly logChannel: PollardLogger) {
    this.enabled = vscode.env.isTelemetryEnabled;
    this.disposables.push(
      vscode.env.onDidChangeTelemetryEnabled((enabled) => {
        this.enabled = enabled;
      })
    );

    const sender: vscode.TelemetrySender = {
      sendEventData: (eventName, data) => {
        this.logChannel.trace(`telemetry: ${eventName} ${JSON.stringify(data ?? {})}`);
      },
      sendErrorData: (error, data) => {
        this.logChannel.trace(`telemetry (error): ${error.message} ${JSON.stringify(data ?? {})}`);
      },
    };
    this.logger = vscode.env.createTelemetryLogger(sender);
    this.disposables.push(this.logger);
  }

  /** Only ever records a command name and an error category — never branch names, repo names, or remote URLs. */
  recordCommandError(command: PollardCommandId, category: ErrorCategory): void {
    // Belt-and-suspenders: gate explicitly in addition to relying on the
    // TelemetryLogger's own internal enablement gating.
    if (!this.enabled) return;
    this.logger.logUsage('commandError', { command, category });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
