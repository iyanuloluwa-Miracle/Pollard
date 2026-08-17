import { PullRequestInfo } from '../providers/types';
import { BranchFacts, PullRequestFacts, assessBranchSafety } from '../safety/engine';
import { BranchAssessment, BucketKind, statusToBucket } from '../views/branchTree';

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
