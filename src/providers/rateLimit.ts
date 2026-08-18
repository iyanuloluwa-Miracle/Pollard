import { RateLimitedError } from '../errors';
import type { RateLimitStatus } from './provider';

export interface GraphQLRateLimit {
  limit: number;
  remaining: number;
  resetAt: string;
  cost: number;
}

export class RateLimiter {
  private limit: number | null = null;
  private remaining: number | null = null;
  private resetAt: Date | null = null;
  private cooldownUntil: number | null = null;

  /** Call after every response, success or failure, to keep state fresh. */
  updateFromHeaders(headers: Headers, kind: 'github' | 'gitlab'): void {
    if (kind === 'github') {
      this.limit = numOrNull(headers.get('x-ratelimit-limit'));
      this.remaining = numOrNull(headers.get('x-ratelimit-remaining'));
      const reset = numOrNull(headers.get('x-ratelimit-reset'));
      if (reset !== null) this.resetAt = new Date(reset * 1000);
    } else {
      this.limit = numOrNull(headers.get('ratelimit-limit'));
      this.remaining = numOrNull(headers.get('ratelimit-remaining'));
      const reset = numOrNull(headers.get('ratelimit-reset'));
      if (reset !== null) this.resetAt = new Date(reset * 1000);
    }
  }

  /** GitHub GraphQL's cost-based budget, read from the response body's `rateLimit` field. */
  updateFromGraphQLRateLimit(rateLimit: GraphQLRateLimit): void {
    this.limit = rateLimit.limit;
    this.remaining = rateLimit.remaining;
    this.resetAt = new Date(rateLimit.resetAt);
  }

  /** Call when a response is 403 (secondary limit) or 429. */
  noteThrottled(retryAfterHeader: string | null): void {
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    this.cooldownUntil =
      retryAfterSec && Number.isFinite(retryAfterSec)
        ? Date.now() + retryAfterSec * 1000
        : (this.resetAt?.getTime() ?? Date.now() + 60_000);
  }

  getStatus(): RateLimitStatus {
    const isLimited = this.cooldownUntil !== null && Date.now() < this.cooldownUntil;
    return { limit: this.limit, remaining: this.remaining, resetAt: this.resetAt, isLimited };
  }

  /** Providers call this before making a request, so a cooling-down provider fails fast locally. */
  throwIfLimited(): void {
    if (this.getStatus().isLimited) throw new RateLimitedError(this.resetAt);
  }
}

function numOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
