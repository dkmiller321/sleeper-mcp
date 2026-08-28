/**
 * Token bucket limiter.
 *
 * Sleeper's documented ceiling is ~1000 requests/minute before you risk an IP
 * block. We default to 600/min so that a burst of derived-tool calls (each of
 * which fans out into several endpoint hits) still leaves headroom.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(perMinute = 600) {
    this.capacity = perMinute;
    this.tokens = perMinute;
    this.refillPerMs = perMinute / 60_000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  /** Resolves once a token is available, consuming it. */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.acquire();
  }
}
