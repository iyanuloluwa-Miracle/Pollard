import { describe, expect, it } from 'vitest';
import { BranchFacts, assessBranchSafety } from './engine';

function facts(overrides: Partial<BranchFacts>): BranchFacts {
  return {
    isCurrent: false,
    isProtected: false,
    mergeStatus: 'not_merged',
    isPushed: true,
    existsOnRemote: true,
    upstreamIsGone: false,
    isAncestorOfAnotherLocalBranch: false,
    pullRequest: null,
    ...overrides,
  };
}

describe('short-circuits', () => {
  it('CURRENT branch scores 0 regardless of other facts', () => {
    const result = assessBranchSafety(facts({ isCurrent: true, mergeStatus: 'merged' }));
    expect(result.status).toBe('CURRENT');
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual(['This is the currently checked-out branch.']);
  });

  it('PROTECTED branch scores 0 regardless of other facts', () => {
    const result = assessBranchSafety(facts({ isProtected: true, mergeStatus: 'merged' }));
    expect(result.status).toBe('PROTECTED');
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual(['This branch is protected.']);
  });

  it('CURRENT takes precedence over PROTECTED when both are true', () => {
    const result = assessBranchSafety(facts({ isCurrent: true, isProtected: true }));
    expect(result.status).toBe('CURRENT');
  });
});

describe('every status is reachable when pushed (cap inert)', () => {
  it('merged into default -> SAFE_MERGED / 100', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'merged', isPushed: true, pullRequest: null })
    );
    expect(result.status).toBe('SAFE_MERGED');
    expect(result.score).toBe(100);
  });

  it('PR merged (squash/rebase) -> SAFE_SQUASH_MERGED / 95', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: true,
        pullRequest: { state: 'closed', merged: true },
      })
    );
    expect(result.status).toBe('SAFE_SQUASH_MERGED');
    expect(result.score).toBe(95);
  });

  it('PR closed unmerged -> WARNING_CLOSED_PR / 60', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: true,
        pullRequest: { state: 'closed', merged: false },
      })
    );
    expect(result.status).toBe('WARNING_CLOSED_PR');
    expect(result.score).toBe(60);
  });

  it('PR open -> WARNING_UNMERGED / 35', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: true,
        pullRequest: { state: 'open', merged: false },
      })
    );
    expect(result.status).toBe('WARNING_UNMERGED');
    expect(result.score).toBe(35);
  });

  it('not merged, no PR -> WARNING_NO_PR / 30', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'not_merged', isPushed: true, pullRequest: null })
    );
    expect(result.status).toBe('WARNING_NO_PR');
    expect(result.score).toBe(30);
  });

  it('indeterminate merge status, no PR -> UNKNOWN / 0', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'unknown', isPushed: true, pullRequest: null })
    );
    expect(result.status).toBe('UNKNOWN');
    expect(result.score).toBe(0);
  });
});

describe('local-only cap boundary conditions', () => {
  it('SAFE_MERGED (100) is never capped, even when unpushed', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'merged', isPushed: false, pullRequest: null })
    );
    expect(result.status).toBe('SAFE_MERGED');
    expect(result.score).toBe(100);
  });

  it('SAFE_SQUASH_MERGED (95) is capped to WARNING_UNMERGED / 35 when unpushed', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        pullRequest: { state: 'closed', merged: true },
      })
    );
    expect(result.status).toBe('WARNING_UNMERGED');
    expect(result.score).toBe(35);
    expect(result.reasons).toHaveLength(2);
  });

  it('WARNING_CLOSED_PR (60) is capped to 35 when unpushed', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        pullRequest: { state: 'closed', merged: false },
      })
    );
    expect(result.status).toBe('WARNING_UNMERGED');
    expect(result.score).toBe(35);
  });

  it('WARNING_UNMERGED (35) stays exactly 35 when unpushed (strict > 35 boundary, no double-application)', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        pullRequest: { state: 'open', merged: false },
      })
    );
    expect(result.status).toBe('WARNING_UNMERGED');
    expect(result.score).toBe(35);
  });

  it('WARNING_NO_PR (30) is never raised by the cap when unpushed', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'not_merged', isPushed: false, pullRequest: null })
    );
    expect(result.status).toBe('WARNING_NO_PR');
    expect(result.score).toBe(30);
  });

  it('UNKNOWN (0) is never raised by the cap when unpushed', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'unknown', isPushed: false, pullRequest: null })
    );
    expect(result.status).toBe('UNKNOWN');
    expect(result.score).toBe(0);
  });
});

describe('nasty case: ancestor of another unmerged local branch', () => {
  it('does NOT exempt the branch from the local-only cap', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        isAncestorOfAnotherLocalBranch: true,
        pullRequest: { state: 'open', merged: false },
      })
    );
    expect(result.status).toBe('WARNING_UNMERGED');
    expect(result.score).toBe(35);
  });

  it('has zero effect on scoring in either direction', () => {
    const withAncestor = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        isAncestorOfAnotherLocalBranch: true,
        pullRequest: { state: 'open', merged: false },
      })
    );
    const withoutAncestor = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        isAncestorOfAnotherLocalBranch: false,
        pullRequest: { state: 'open', merged: false },
      })
    );
    expect(withAncestor.score).toBe(withoutAncestor.score);
    expect(withAncestor.status).toBe(withoutAncestor.status);
  });
});

describe('nasty case: rebased branch (content preserved, SHAs changed)', () => {
  it('a stale same-name remote ref (existsOnRemote) does not affect the cap — only isPushed (tip reachability) matters', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'not_merged', isPushed: false, existsOnRemote: true, pullRequest: null })
    );
    expect(result.status).toBe('WARNING_NO_PR');
    expect(result.score).toBe(30);
  });
});

describe('nasty case: force-pushed branch', () => {
  it('force-push succeeded (isPushed: true) -> uncapped', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: true,
        pullRequest: { state: 'closed', merged: true },
      })
    );
    expect(result.status).toBe('SAFE_SQUASH_MERGED');
    expect(result.score).toBe(95);
  });

  it('force-push has not happened (isPushed: false) -> capped, same as an ordinary unpushed branch', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        pullRequest: { state: 'closed', merged: true },
      })
    );
    expect(result.status).toBe('WARNING_UNMERGED');
    expect(result.score).toBe(35);
  });
});

describe('nasty case: branch tracking a deleted remote', () => {
  it('merged branch with a gone upstream is still SAFE_MERGED, with an informational reason and no cap note', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'merged',
        upstreamIsGone: true,
        existsOnRemote: false,
        isPushed: true,
        pullRequest: null,
      })
    );
    expect(result.status).toBe('SAFE_MERGED');
    expect(result.score).toBe(100);
    expect(result.reasons).toContain(
      'The upstream remote-tracking branch no longer exists (likely deleted after merge).'
    );
    expect(result.reasons.some((r) => r.includes('capped'))).toBe(false);
  });

  it('abandoned branch with a gone upstream and no backup gets both the upstream-gone note and the cap note, in order', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        upstreamIsGone: true,
        existsOnRemote: false,
        isPushed: false,
        pullRequest: { state: 'closed', merged: false },
      })
    );
    expect(result.status).toBe('WARNING_UNMERGED');
    expect(result.score).toBe(35);
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons[0]).toBe('Associated pull request was closed without being merged.');
    expect(result.reasons[1]).toBe(
      'The upstream remote-tracking branch no longer exists (likely deleted after merge).'
    );
    expect(result.reasons[2]).toContain('capped');
  });
});

describe('nasty case: detached HEAD', () => {
  it('a branch with isCurrent: false is assessed normally, with no special-casing needed for detached HEAD', () => {
    const result = assessBranchSafety(
      facts({ isCurrent: false, mergeStatus: 'merged', pullRequest: null })
    );
    expect(result.status).toBe('SAFE_MERGED');
  });
});

describe('nasty case: branch with an upstream on a fork', () => {
  it('isPushed is remote-agnostic — BranchFacts exposes no remote identity for the engine to special-case', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: true,
        pullRequest: { state: 'closed', merged: true },
      })
    );
    expect(result.status).toBe('SAFE_SQUASH_MERGED');
    expect(result.score).toBe(95);
  });
});

describe('reasons array content', () => {
  it('SAFE_MERGED with no extra facts has exactly one reason', () => {
    const result = assessBranchSafety(
      facts({ mergeStatus: 'merged', isPushed: true, pullRequest: null })
    );
    expect(result.reasons).toEqual([
      'Branch is fully merged into the default branch (commits are reachable).',
    ]);
  });

  it('a capped assessment has [primary reason, cap reason], in order', () => {
    const result = assessBranchSafety(
      facts({
        mergeStatus: 'not_merged',
        isPushed: false,
        pullRequest: { state: 'closed', merged: true },
      })
    );
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons[0]).toBe(
      'Associated pull request was merged (commits were likely squashed or rebased, so they are not directly reachable from the default branch).'
    );
    expect(result.reasons[1]).toContain('capped');
  });

  it('CURRENT/PROTECTED short-circuits produce no cap or upstream-gone text even when facts would otherwise trigger them', () => {
    const current = assessBranchSafety(
      facts({ isCurrent: true, mergeStatus: 'not_merged', isPushed: false, upstreamIsGone: true })
    );
    expect(current.reasons).toEqual(['This is the currently checked-out branch.']);

    const protectedBranch = assessBranchSafety(
      facts({ isProtected: true, mergeStatus: 'not_merged', isPushed: false, upstreamIsGone: true })
    );
    expect(protectedBranch.reasons).toEqual(['This branch is protected.']);
  });
});
