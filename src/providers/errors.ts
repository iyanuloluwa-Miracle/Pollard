export class RateLimitedError extends Error {
  constructor(public readonly resetAt: Date | null) {
    super('Provider is rate limited');
    this.name = 'RateLimitedError';
  }
}

export class AuthRequiredError extends Error {
  constructor(public readonly providerId: 'github' | 'gitlab') {
    super(`${providerId} requires authentication`);
    this.name = 'AuthRequiredError';
  }
}
