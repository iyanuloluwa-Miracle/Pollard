import { describe, expect, it } from 'vitest';
import { parseGitRemoteUrl } from './remote-url';

describe('scp-style ssh', () => {
  it('git@host:owner/repo.git', () => {
    expect(parseGitRemoteUrl('git@github.com:iyanuloluwa-Miracle/Pollard.git')).toEqual({
      host: 'github.com',
      owner: 'iyanuloluwa-Miracle',
      repo: 'Pollard',
    });
  });

  it('git@host:owner/repo (no .git suffix)', () => {
    expect(parseGitRemoteUrl('git@gitlab.com:owner/repo')).toEqual({
      host: 'gitlab.com',
      owner: 'owner',
      repo: 'repo',
    });
  });
});

describe('ssh:// urls', () => {
  it('ssh://host/owner/repo.git', () => {
    expect(parseGitRemoteUrl('ssh://github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ssh://user@host/owner/repo.git', () => {
    expect(parseGitRemoteUrl('ssh://git@github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });
});

describe('https:// urls', () => {
  it('https://host/owner/repo.git', () => {
    expect(parseGitRemoteUrl('https://github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('https://host/owner/repo (no .git suffix)', () => {
    expect(parseGitRemoteUrl('https://github.com/owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('https://user@host/owner/repo.git (credentials in URL)', () => {
    expect(parseGitRemoteUrl('https://token@github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('trailing slash is stripped', () => {
    expect(parseGitRemoteUrl('https://github.com/owner/repo/')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });
});

describe('GitLab-style nested groups', () => {
  it('owner joins every path segment but the last', () => {
    expect(parseGitRemoteUrl('https://gitlab.com/group/subgroup/repo.git')).toEqual({
      host: 'gitlab.com',
      owner: 'group/subgroup',
      repo: 'repo',
    });
  });

  it('also works over ssh://', () => {
    expect(parseGitRemoteUrl('ssh://git@gitlab.com/group/subgroup/repo.git')).toEqual({
      host: 'gitlab.com',
      owner: 'group/subgroup',
      repo: 'repo',
    });
  });
});

describe('host normalization', () => {
  it('host is lowercased', () => {
    expect(parseGitRemoteUrl('https://GitHub.COM/owner/repo.git')?.host).toBe('github.com');
  });
});

describe('unparseable input', () => {
  it('returns undefined for a bare host with no owner/repo path', () => {
    expect(parseGitRemoteUrl('https://github.com/')).toBeUndefined();
  });

  it('returns undefined for a single path segment (no owner)', () => {
    expect(parseGitRemoteUrl('https://github.com/repo')).toBeUndefined();
  });

  it('returns undefined for a non-URL string', () => {
    expect(parseGitRemoteUrl('not a url at all')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseGitRemoteUrl('')).toBeUndefined();
  });
});
