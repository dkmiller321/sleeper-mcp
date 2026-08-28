import { describe, expect, it } from 'vitest';
import { NotFoundError, RateLimitError, SleeperApiError, SleeperClient } from '../src/client.js';
import { makeFetchStub } from './fixtures.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('SleeperClient error handling', () => {
  it('treats HTTP 200 with a null body as not found', async () => {
    // This is the real behaviour for an unknown username and the single easiest
    // thing to get wrong: the status code says success.
    const { fetch } = makeFetchStub();
    const client = new SleeperClient({ fetchImpl: fetch });
    await expect(client.get('/user/nobody-here')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('treats HTTP 404 as not found', async () => {
    const { fetch } = makeFetchStub();
    const client = new SleeperClient({ fetchImpl: fetch });
    await expect(client.get('/league/000')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('treats an empty body as not found', async () => {
    const fetchImpl = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl });
    await expect(client.get('/anything')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not retry a 404', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return json(null, 404);
    }) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl, maxRetries: 3 });
    await expect(client.get('/league/000')).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toBe(1);
  });

  it('retries a 429 and succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? json(null, 429) : json({ ok: true });
    }) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl, maxRetries: 2 });
    await expect(client.get('/state/nfl')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('surfaces a rate limit error after exhausting retries', async () => {
    const fetchImpl = (async () => json(null, 429)) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl, maxRetries: 1 });
    await expect(client.get('/state/nfl')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('retries a 500 and gives up with an API error', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return json(null, 500);
    }) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl, maxRetries: 2 });
    await expect(client.get('/state/nfl')).rejects.toBeInstanceOf(SleeperApiError);
    expect(calls).toBe(3);
  });

  it('retries a network failure', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) throw new TypeError('network down');
      return json({ ok: true });
    }) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl, maxRetries: 2 });
    await expect(client.get('/state/nfl')).resolves.toEqual({ ok: true });
  });

  it('throws immediately on a 400', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return json(null, 400);
    }) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl, maxRetries: 2 });
    await expect(client.get('/bad')).rejects.toBeInstanceOf(SleeperApiError);
    expect(calls).toBe(1);
  });
});

describe('SleeperClient request handling', () => {
  it('dedupes identical concurrent requests', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return json({ ok: true });
    }) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl });
    await Promise.all([client.get('/state/nfl'), client.get('/state/nfl'), client.get('/state/nfl')]);
    expect(calls).toBe(1);
  });

  it('appends query parameters and skips undefined ones', async () => {
    let seen = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen = String(input);
      return json([]);
    }) as unknown as typeof fetch;
    const client = new SleeperClient({ fetchImpl });
    await client.get('/players/nfl/trending/add', { limit: 10, lookback_hours: undefined });
    expect(seen).toContain('limit=10');
    expect(seen).not.toContain('lookback_hours');
  });
});
