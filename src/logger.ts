import * as vscode from 'vscode';

const RING_BUFFER_MAX_LINES = 500;

/**
 * Thin facade over a vscode.LogOutputChannel, adding an in-memory ring
 * buffer so pollard.doctor can read back recent log lines — VS Code's
 * OutputChannel API has no read-back method of its own. Every method here
 * mirrors the LogOutputChannel method of the same name that call sites
 * across the codebase already use, so nothing at those call sites changes.
 */
export class PollardLogger implements vscode.Disposable {
  private readonly channel: vscode.LogOutputChannel;
  private readonly recentLines: string[] = [];

  constructor(name = 'Pollard') {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  private remember(line: string): void {
    this.recentLines.push(line);
    if (this.recentLines.length > RING_BUFFER_MAX_LINES) this.recentLines.shift();
  }

  trace(message: string, ...args: unknown[]): void {
    this.remember(`[trace] ${message}`);
    this.channel.trace(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.remember(`[info] ${message}`);
    this.channel.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.remember(`[warn] ${message}`);
    this.channel.warn(message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.remember(`[error] ${message}`);
    this.channel.error(message, ...args);
  }

  appendLine(value: string): void {
    this.remember(value);
    this.channel.appendLine(value);
  }

  show(): void {
    this.channel.show();
  }

  /** Last `n` lines written via any of the methods above, oldest first. Used by pollard.doctor. */
  getRecentLines(n: number): string[] {
    return this.recentLines.slice(-n);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
