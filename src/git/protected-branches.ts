/**
 * Pure, framework-free protected-branch glob matching + merge-vs-replace
 * resolution — no imports, so it's usable both from config.ts (which reads
 * the live settings) and directly from git/branch-facts.ts, which must stay
 * free of any vscode dependency (vitest runs tests in a plain node
 * environment with no vscode module resolvable).
 */

export const DEFAULT_PROTECTED_BRANCH_PATTERNS: readonly string[] = [
  'main',
  'master',
  'develop',
  'dev',
  'staging',
  'release/*',
  'hotfix/*',
];

/**
 * If replaceDefaults is true, the result is exactly userPatterns
 * (deduplicated). Otherwise it's DEFAULT_PROTECTED_BRANCH_PATTERNS unioned
 * with userPatterns, deduplicated. When userPatterns is itself just the
 * unmodified schema default, both branches produce the same result, so
 * replaceDefaults is correctly a no-op in that case — there's nothing to
 * replace when nothing was customized.
 */
export function resolveProtectedBranchPatterns(
  userPatterns: string[],
  replaceDefaults: boolean
): string[] {
  const merged = replaceDefaults
    ? userPatterns
    : [...DEFAULT_PROTECTED_BRANCH_PATTERNS, ...userPatterns];
  return [...new Set(merged)];
}

/** True if branchName matches any of the given glob patterns (see globToRegExp for supported syntax). */
export function matchesAnyPattern(branchName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(branchName));
}

/**
 * Converts a glob pattern to a fully-anchored RegExp. Only `*` is supported
 * as a wildcard (no `**`, `?`, or bracket classes — nothing here needs
 * them). `*` matches zero or more of ANY character, including `/`:
 * "release/*" matches both "release/2.0" and "release/2.0/hotfix". This is
 * deliberately permissive: for a protected-branches matcher, a false
 * "protected" only costs a skipped deletion candidate (annoying, easily
 * corrected by narrowing the pattern), while a false "not protected" could
 * let something a user assumed a pattern covered get offered for deletion.
 * The permissive reading is the safer failure mode.
 */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}
