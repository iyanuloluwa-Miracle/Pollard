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

const LOCAL_ONLY_CAP_SCORE = 35;

export function assessBranchSafety(facts: BranchFacts): SafetyAssessment {
  if (facts.isCurrent) {
    return { status: 'CURRENT', score: 0, reasons: ['This is the currently checked-out branch.'] };
  }
  if (facts.isProtected) {
    return { status: 'PROTECTED', score: 0, reasons: ['This branch is protected.'] };
  }

  const base = computeBaseAssessment(facts);
  return applyLocalOnlyCap(facts, base);
}

function computeBaseAssessment(facts: BranchFacts): SafetyAssessment {
  const reasons: string[] = [];
  let status: SafetyStatus;
  let score: number;

  if (facts.mergeStatus === 'merged') {
    status = 'SAFE_MERGED';
    score = 100;
    reasons.push('Branch is fully merged into the default branch (commits are reachable).');
  } else if (facts.pullRequest?.merged) {
    status = 'SAFE_SQUASH_MERGED';
    score = 95;
    reasons.push(
      'Associated pull request was merged (commits were likely squashed or rebased, so they are not directly reachable from the default branch).'
    );
  } else if (facts.pullRequest?.state === 'closed') {
    status = 'WARNING_CLOSED_PR';
    score = 60;
    reasons.push('Associated pull request was closed without being merged.');
  } else if (facts.pullRequest?.state === 'open') {
    status = 'WARNING_UNMERGED';
    score = 35;
    reasons.push('Associated pull request is still open.');
  } else if (facts.mergeStatus === 'not_merged') {
    status = 'WARNING_NO_PR';
    score = 30;
    reasons.push(
      'Branch is not merged into the default branch and has no associated pull request.'
    );
  } else {
    status = 'UNKNOWN';
    score = 0;
    reasons.push(
      'Could not determine whether this branch is merged into the default branch, and no pull request was found.'
    );
  }

  if (facts.upstreamIsGone) {
    reasons.push(
      'The upstream remote-tracking branch no longer exists (likely deleted after merge).'
    );
  }

  return { status, score, reasons };
}

/**
 * Work that exists only on this machine must never score above
 * LOCAL_ONLY_CAP_SCORE, regardless of what PR metadata claims — a second
 * local branch reaching the same tip is not a safe backstop, since it's
 * just another ref this tool's own "clean" operation could delete.
 */
function applyLocalOnlyCap(facts: BranchFacts, base: SafetyAssessment): SafetyAssessment {
  const localOnly = facts.mergeStatus !== 'merged' && !facts.isPushed;
  if (localOnly && base.score > LOCAL_ONLY_CAP_SCORE) {
    return {
      status: 'WARNING_UNMERGED',
      score: LOCAL_ONLY_CAP_SCORE,
      reasons: [
        ...base.reasons,
        'Branch has commits that exist only on this machine (unmerged and not pushed to any remote); score capped to prevent accidental permanent loss.',
      ],
    };
  }
  return base;
}
