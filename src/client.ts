import { RateLimiter } from './ratelimit.js';

export const BASE_URL = 'https://api.sleeper.app/v1';

/**
 * The resource does not exist.
 *
 * Sleeper signals this two different ways and both must be caught:
 *   GET /user/<bad-username>  -> HTTP 200, body `null`
 *   GET /league/<bad-id>      -> HTTP 404, body `null`
 * Checking the status code alone would treat a typo'd username as success.
 */
export class NotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Sleeper returned no data for ${path}. Check that the ID or username is correct.`);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends Error {
  constructor() {
    super(
      'Sleeper rate-limited this request (HTTP 429). Sleeper blocks IPs above ~1000 calls/min; wait a moment before retrying.',
    );
    this.name = 'RateLimitError';
  }
}

export class SleeperApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`Sleeper API error ${status} for ${path}`);
    this.name = 'SleeperApiError';
  }
}

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  perMinute?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SleeperClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  /** Dedupes concurrent identical in-flight requests. */
  private inflight = new Map<string, Promise<unknown>>();

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.limiter = new RateLimiter(opts.perMinute ?? 600);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * GETs `path` and returns parsed JSON. Throws NotFoundError when Sleeper
   * reports the resource as missing (either of its two shapes).
   *
   * Note: we deliberately do not set Accept-Encoding. Node's fetch already
   * negotiates gzip and decompresses transparently; setting it by hand can
   * hand back a raw compressed body instead.
   */
  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const href = url.href;

    const existing = this.inflight.get(href);
    if (existing) return existing as Promise<T>;

    const promise = this.execute<T>(href, path).finally(() => {
      this.inflight.delete(href);
    });
    this.inflight.set(href, promise);
    return promise;
  }

  private async execute<T>(href: string, path: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter so parallel tools do not resynchronize.
        await sleep(2 ** attempt * 250 + Math.random() * 250);
      }
      await this.limiter.acquire();

      try {
        const response = await this.fetchImpl(href, {
          headers: { accept: 'application/json', 'user-agent': 'sleeper-mcp/0.1.0' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 404) throw new NotFoundError(path);
        if (response.status === 429) {
          lastError = new RateLimitError();
          continue;
        }
        if (response.status >= 500) {
          lastError = new SleeperApiError(response.status, path);
          continue;
        }
        if (!response.ok) throw new SleeperApiError(response.status, path);

        const text = await response.text();
        // An empty body or the literal `null` both mean "no such resource".
        if (text.trim() === '' || text.trim() === 'null') throw new NotFoundError(path);

        return JSON.parse(text) as T;
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof SleeperApiError) throw err;
        // Network failure or timeout — retry.
        lastError = err;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new SleeperApiError(0, path);
  }
}
