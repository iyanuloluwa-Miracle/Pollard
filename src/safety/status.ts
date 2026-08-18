import { SafetyStatus } from './types';

export type BucketKind = 'safe' | 'squashMerged' | 'warnings' | 'protected' | 'unscanned';

export const UNSCANNED_CONTEXT_VALUE = 'UNSCANNED';

const STATUS_DISPLAY: Record<
  SafetyStatus,
  { bucket: BucketKind; icon: string; color: string | undefined }
> = {
  SAFE_MERGED: { bucket: 'safe', icon: 'check', color: 'charts.green' },
  SAFE_SQUASH_MERGED: { bucket: 'squashMerged', icon: 'check-all', color: 'charts.green' },
  WARNING_CLOSED_PR: {
    bucket: 'warnings',
    icon: 'git-pull-request-closed',
    color: 'charts.orange',
  },
  WARNING_UNMERGED: { bucket: 'warnings', icon: 'git-pull-request', color: 'charts.yellow' },
  WARNING_NO_PR: { bucket: 'warnings', icon: 'warning', color: 'charts.yellow' },
  UNKNOWN: { bucket: 'warnings', icon: 'question', color: 'charts.yellow' },
  PROTECTED: { bucket: 'protected', icon: 'shield', color: 'charts.blue' },
  CURRENT: { bucket: 'protected', icon: 'target', color: 'charts.purple' },
};

export function statusToBucket(status: SafetyStatus): BucketKind {
  return STATUS_DISPLAY[status].bucket;
}

export function statusIconAndColor(status: SafetyStatus): {
  icon: string;
  color: string | undefined;
} {
  return STATUS_DISPLAY[status];
}
