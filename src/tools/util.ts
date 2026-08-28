import { NotFoundError, RateLimitError, SleeperApiError } from '../client.js';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export function ok(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Runs a tool body and turns any thrown error into a readable message.
 *
 * Sleeper's failure modes are unusual enough to be worth naming explicitly —
 * a bad username comes back as HTTP 200 with a `null` body, which would
 * otherwise surface as an opaque parse failure.
 */
export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) return fail(err.message);
    if (err instanceof RateLimitError) return fail(err.message);
    if (err instanceof SleeperApiError) return fail(err.message);
    if (err instanceof Error) return fail(`Unexpected error: ${err.message}`);
    return fail(`Unexpected error: ${String(err)}`);
  }
}
