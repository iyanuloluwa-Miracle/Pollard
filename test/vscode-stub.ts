/**
 * Hand-rolled stand-in for the 'vscode' module, aliased in via
 * vitest.config.mts so provider files that reach `vscode` at the value
 * level — only ever for auth (github-auth.ts's getGithubSession) and
 * notification/logging plumbing (errors.ts) in the code paths under test —
 * can load under vitest without a real VS Code host. Named exports only,
 * matching the shape `import * as vscode from 'vscode'` collects into a
 * namespace object.
 */

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void): { dispose: () => void } => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
  dispose(): void {}
}

/** Mutable per-test auth state — tests set this directly before calling a provider method. */
export const authState: { githubSession: { accessToken: string } | undefined } = {
  githubSession: { accessToken: 'fake-github-token' },
};

export const authentication = {
  getSession: async () => authState.githubSession,
};

export const window = {
  showInputBox: async () => undefined,
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  createOutputChannel: () => ({
    appendLine() {},
    append() {},
    show() {},
    hide() {},
    dispose() {},
    clear() {},
    replace() {},
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    logLevel: 1,
    onDidChangeLogLevel: new EventEmitter<number>().event,
  }),
};

export const commands = {
  executeCommand: async () => undefined,
};
