export { runGit, getGitVersion } from './exec';
export {
  computeLocalBranchFacts,
  DefaultBranchInfo,
  pickPrimaryRemoteName,
  resolveDefaultBranch,
} from './branches';
export {
  BACKUP_REF_PREFIX,
  BackupRef,
  BackupRefEntry,
  deleteBackupRef,
  listBackupRefs,
  restoreBranchFromBackup,
  writeBackupRef,
} from './backup';
export {
  API,
  Branch,
  Commit,
  Git,
  GitExtension,
  Ref,
  REF_TYPE_HEAD,
  REF_TYPE_REMOTE_HEAD,
  Remote,
  RemoteInfo,
  Repository,
  RepositoryState,
  UpstreamRef,
} from './types';
