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
    const response = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => undefined)) as T;
    return { data, response };
  } finally {
    clearTimeout(timeout);
  }
}
