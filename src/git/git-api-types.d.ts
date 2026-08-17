/**
 * Trimmed subset of the official `vscode.git` extension's exported API
 * (https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts).
 * Not published to npm — the extension exposes these types only via its
 * runtime exports, so the slice actually used here is vendored by hand.
 */

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface Ref {
  /** 0 = Head, 1 = RemoteHead, 2 = Tag — see REF_TYPE_HEAD in git-extension.ts. */
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface RepositoryState {
  readonly remotes: Remote[];
  readonly refs: Ref[];
}

export interface Repository {
  readonly rootUri: { readonly fsPath: string };
  readonly state: RepositoryState;
}

export interface API {
  readonly repositories: Repository[];
}

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}
