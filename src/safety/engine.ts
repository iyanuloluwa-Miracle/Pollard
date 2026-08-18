import { PullRequestInfo } from '../providers/provider';
import { statusToBucket, BucketKind } from './status';
import { BranchAssessment, BranchFacts, PullRequestFacts, SafetyAssessment, SafetyStatus } from './types';

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

export interface RepoBucketCounts {
  safe: number;
  squashMerged: number;
  warnings: number;
  protectedCount: number;
  unscanned: number;
}

const BUCKET_FIELD: Record<BucketKind, keyof RepoBucketCounts> = {
  safe: 'safe',
  squashMerged: 'squashMerged',
  warnings: 'warnings',
  protected: 'protectedCount',
  unscanned: 'unscanned',
};

function emptyBucketCounts(): RepoBucketCounts {
  return { safe: 0, squashMerged: 0, warnings: 0, protectedCount: 0, unscanned: 0 };
}

/** Prefer merged > open > closed; tie-break on highest id (most recent). */
export function pickRepresentativePullRequest(prs: PullRequestInfo[]): PullRequestInfo | undefined {
  if (prs.length === 0) return undefined;
  const rank = (pr: PullRequestInfo) => (pr.merged ? 2 : pr.state === 'open' ? 1 : 0);
  return [...prs].sort((a, b) => rank(b) - rank(a) || b.id - a.id)[0];
}

function toPullRequestFacts(pr: PullRequestInfo | undefined): PullRequestFacts | null {
  if (!pr) return null;
  return { state: pr.state === 'open' ? 'open' : 'closed', merged: pr.merged };
}

/** The only place a full BranchFacts is assembled from parts — shared by scan's "assessing" phase and refresh. */
export function buildRepoAssessments(
  localFacts: Map<string, Omit<BranchFacts, 'pullRequest'>>,
  prsByBranch: Map<string, PullRequestInfo[]>
): Map<string, BranchAssessment> {
  const out = new Map<string, BranchAssessment>();
  for (const [branchName, partial] of localFacts) {
    const prs = prsByBranch.get(branchName) ?? [];
    const representative = pickRepresentativePullRequest(prs);
    const facts: BranchFacts = { ...partial, pullRequest: toPullRequestFacts(representative) };
    out.set(branchName, {
      assessment: assessBranchSafety(facts),
      pullRequest: representative ?? null,
    });
  }
  return out;
}

export function tallyBucketCounts(assessments: Map<string, BranchAssessment>): RepoBucketCounts {
  const counts = emptyBucketCounts();
  for (const { assessment } of assessments.values()) {
    counts[BUCKET_FIELD[statusToBucket(assessment.status)]]++;
  }
  return counts;
}
