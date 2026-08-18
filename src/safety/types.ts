import { PullRequestInfo } from '../providers';

export interface PullRequestFacts {
  /** A PR is only ever open or closed at the VCS level; "merged" only means anything once closed. */
  state: 'open' | 'closed';
  merged: boolean;
}

/**
 * 'unknown' = indeterminate, e.g. a shallow clone where merge-base can't be
 * computed, or the default branch ref isn't resolvable locally.
 */
export type MergeStatus = 'merged' | 'not_merged' | 'unknown';

export interface BranchFacts {
  isCurrent: boolean;
  isProtected: boolean;
  /** Is this branch's tip reachable from the default branch's tip? */
  mergeStatus: MergeStatus;
  /** Does some remote currently have a ref reaching this branch's tip (i.e. is the content backed up off-machine)? */
  isPushed: boolean;
  /** Does a branch of this name currently exist on some remote? Can diverge from isPushed after a force-push/rebase. Informational only. */
  existsOnRemote: boolean;
  /** Was there a configured upstream that has since disappeared ("gone")? Informational only — never affects score. */
  upstreamIsGone: boolean;
  /** Is this branch's tip also reachable from some other local branch? Informational only — never affects score, since a second local ref is not a safe backstop. */
  isAncestorOfAnotherLocalBranch: boolean;
  pullRequest: PullRequestFacts | null;
}

export type SafetyStatus =
  | 'SAFE_MERGED'
  | 'SAFE_SQUASH_MERGED'
  | 'WARNING_CLOSED_PR'
  | 'WARNING_UNMERGED'
  | 'WARNING_NO_PR'
  | 'PROTECTED'
  | 'CURRENT'
  | 'UNKNOWN';

export interface SafetyAssessment {
  status: SafetyStatus;
  score: number;
  reasons: string[];
}

export interface BranchAssessment {
  assessment: SafetyAssessment;
  pullRequest: PullRequestInfo | null;
}
