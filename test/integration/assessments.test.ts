import * as assert from 'assert';
import { resolveDefaultBranch, computeLocalBranchFacts } from '../../src/git/branch-facts';
import { RepoRegistry } from '../../src/git/repo-registry';
import { PullRequestInfo } from '../../src/providers/types';
import { BranchFacts } from '../../src/safety/engine';
import { buildRepoAssessments } from '../../src/scan/assess';

function fakePr(branch: string, merged: boolean): PullRequestInfo {
  return {
    id: 1,
    url: `https://example.com/${branch}`,
    title: branch,
    state: merged ? 'merged' : 'open',
    merged,
    mergedAt: merged ? new Date().toISOString() : null,
    sourceBranch: branch,
  };
}

describe('integration: branch assessments from real git history', () => {
  let registry: RepoRegistry;
  let repoId: string;

  before(async () => {
    registry = RepoRegistry.create();
    await registry.whenReady();
    const repo = registry.repos[0];
    assert.ok(repo, 'expected the fixture repo to be open as the workspace folder');
    repoId = repo.id;
  });

  after(() => {
    registry.dispose();
  });

  async function assess(
    branchName: string,
    fakePrs: PullRequestInfo[] = []
  ): Promise<{
    facts: Omit<BranchFacts, 'pullRequest'>;
    assessment: ReturnType<typeof buildRepoAssessments>;
  }> {
    const repo = registry.repos.find((r) => r.id === repoId);
    assert.ok(repo);
    const defaultBranch = await resolveDefaultBranch(registry, repo);
    const localFacts = await computeLocalBranchFacts(registry, repo, defaultBranch, []);
    const facts = localFacts.get(branchName);
    assert.ok(facts, `expected local facts for ${branchName}`);
    const prsByBranch = new Map([[branchName, fakePrs]]);
    const assessment = buildRepoAssessments(localFacts, prsByBranch);
    return { facts, assessment };
  }

  it('feature/merged -> SAFE_MERGED / 100', async () => {
    const { facts, assessment } = await assess('feature/merged');
    assert.strictEqual(facts.mergeStatus, 'merged');
    const result = assessment.get('feature/merged');
    assert.strictEqual(result?.assessment.status, 'SAFE_MERGED');
    assert.strictEqual(result?.assessment.score, 100);
  });

  it('feature/squashed -> not_merged locally, SAFE_SQUASH_MERGED once PR data is applied', async () => {
    const { facts, assessment } = await assess('feature/squashed', [
      fakePr('feature/squashed', true),
    ]);
    assert.strictEqual(facts.mergeStatus, 'not_merged');
    assert.strictEqual(facts.isPushed, true);
    const result = assessment.get('feature/squashed');
    assert.strictEqual(result?.assessment.status, 'SAFE_SQUASH_MERGED');
    assert.strictEqual(result?.assessment.score, 95);
  });

  it('feature/rebased -> stale remote name, unreachable new tip -> WARNING_NO_PR / 30', async () => {
    const { facts, assessment } = await assess('feature/rebased');
    assert.strictEqual(facts.existsOnRemote, true);
    assert.strictEqual(facts.isPushed, false);
    const result = assessment.get('feature/rebased');
    assert.strictEqual(result?.assessment.status, 'WARNING_NO_PR');
    assert.strictEqual(result?.assessment.score, 30);
  });

  it('feature/force-pushed -> local-only cap fires despite a merged PR -> WARNING_UNMERGED / 35', async () => {
    const { facts, assessment } = await assess('feature/force-pushed', [
      fakePr('feature/force-pushed', true),
    ]);
    assert.strictEqual(facts.isPushed, false);
    const result = assessment.get('feature/force-pushed');
    assert.strictEqual(result?.assessment.status, 'WARNING_UNMERGED');
    assert.strictEqual(result?.assessment.score, 35);
  });

  it('feature/unpushed -> local-only, no PR -> WARNING_NO_PR / 30 (cap not triggered, below threshold)', async () => {
    const { facts, assessment } = await assess('feature/unpushed');
    assert.strictEqual(facts.existsOnRemote, false);
    assert.strictEqual(facts.isPushed, false);
    const result = assessment.get('feature/unpushed');
    assert.strictEqual(result?.assessment.status, 'WARNING_NO_PR');
    assert.strictEqual(result?.assessment.score, 30);
  });
});
