import { BucketKind } from '../safety/status';

export type BranchTreeElement =
  | { kind: 'repo'; id: string; repoId: string }
  | { kind: 'bucket'; id: string; repoId: string; bucket: BucketKind }
  | { kind: 'branch'; id: string; repoId: string; branchName: string; sha: string }
  | { kind: 'message'; id: string; repoId: string; text: string; commandId?: string }
  | { kind: 'banner'; id: string; text: string };

export function makeRepoElement(repoId: string): BranchTreeElement {
  return { kind: 'repo', id: `repo:${repoId}`, repoId };
}

export function makeBucketElement(repoId: string, bucket: BucketKind): BranchTreeElement {
  return { kind: 'bucket', id: `bucket:${repoId}:${bucket}`, repoId, bucket };
}

export function makeBranchElement(repoId: string, branchName: string, sha: string): BranchTreeElement {
  return { kind: 'branch', id: `branch:${repoId}:${branchName}`, repoId, branchName, sha };
}

export function makeMessageElement(
  repoId: string,
  slug: string,
  text: string,
  commandId?: string
): BranchTreeElement {
  return { kind: 'message', id: `message:${repoId}:${slug}`, repoId, text, commandId };
}

export function makeBannerElement(): BranchTreeElement {
  return { kind: 'banner', id: 'banner:offline', text: 'Offline — showing cached results only.' };
}
