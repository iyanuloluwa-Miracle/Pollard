import * as assert from 'assert';
import {
  BACKUP_REF_PREFIX,
  listBackupRefs,
  restoreBranchFromBackup,
  writeBackupRef,
} from '../../src/backup/backupRefs';
import { RepoRegistry } from '../../src/git/repo-registry';

describe('e2e: delete a branch, restore it from its backup ref', () => {
  let registry: RepoRegistry;
  let repoId: string;
  const branchName = 'feature/for-deletion';

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

  it('creates a backup ref, deletes the branch, then restores it with a matching SHA', async () => {
    const before = await registry.getBranchDetails(repoId, branchName);
    assert.ok(before?.commit, 'expected feature/for-deletion to exist before the test runs');
    const originalSha = before.commit as string;

    const { refPath } = await writeBackupRef(registry, repoId, branchName, originalSha);
    assert.match(refPath, new RegExp(`^${BACKUP_REF_PREFIX}${branchName}/\\d+$`));

    await registry.deleteBranch(repoId, branchName, true);
    const afterDelete = await registry.getBranchDetails(repoId, branchName);
    assert.strictEqual(afterDelete, undefined);

    const backups = await listBackupRefs(registry, repoId);
    const entry = backups.find((b) => b.refPath === refPath);
    assert.ok(entry, 'expected the backup ref to be discoverable via listBackupRefs');
    assert.strictEqual(entry?.sha, originalSha);

    await restoreBranchFromBackup(registry, repoId, branchName, refPath);
    const restored = await registry.getBranchDetails(repoId, branchName);
    assert.strictEqual(restored?.commit, originalSha);
  });
});
