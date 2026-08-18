import { OfflineError } from '../errors';

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface FetchJsonResult<T> {
  data: T;
  response: Response;
}

export async function fetchJson<T>(
  url: string,
  opts: FetchJsonOptions = {}
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: { 'content-type': 'application/json', ...opts.headers },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError (the timeout above) is a slow-but-reachable server —
      // distinct from no connectivity at all, so it's left unclassified here.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new OfflineError({ cause: err });
    }
    const data = (await response.json().catch(() => undefined)) as T;
    return { data, response };
  } finally {
    clearTimeout(timeout);
  }
}
