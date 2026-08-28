import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** In-memory TTL cache. Values are shared by reference — treat them as immutable. */
export class TtlCache {
  private entries = new Map<string, { value: unknown; expiresAt: number }>();

  get<T>(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Runs `fn` only on a miss. Concurrent misses are not deduped — callers do that. */
  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** TTLs, in ms. Chosen for how fast each resource actually changes. */
export const TTL = {
  /** Advisory only: the player map is kept until an explicit refresh (see PlayerIndex). */
  playerMapStaleAfter: 24 * 60 * 60 * 1000,
  state: 60 * 60 * 1000,
  league: 5 * 60 * 1000,
  rosters: 5 * 60 * 1000,
  users: 5 * 60 * 1000,
  matchups: 60 * 1000,
  drafts: 5 * 60 * 1000,
  completedDraft: 24 * 60 * 60 * 1000,
  transactions: 60 * 1000,
  trending: 15 * 60 * 1000,
} as const;

function cacheRoot(): string {
  if (process.env.SLEEPER_MCP_CACHE_DIR) return process.env.SLEEPER_MCP_CACHE_DIR;
  const home = homedir();
  if (!home) return join(tmpdir(), 'sleeper-mcp');
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'sleeper-mcp', 'cache');
  }
  return join(process.env.XDG_CACHE_HOME ?? join(home, '.cache'), 'sleeper-mcp');
}

/**
 * Disk cache, used only for the player map — it is ~15MB uncompressed and we do
 * not want to re-download it on every server start.
 */
export class DiskCache {
  constructor(private readonly root = cacheRoot()) {}

  private pathFor(name: string): string {
    return join(this.root, `${name}.json`);
  }

  async read<T>(name: string, maxAgeMs: number): Promise<T | undefined> {
    return (await this.readWithMeta<T>(name, maxAgeMs))?.value;
  }

  /** Like `read`, but also reports when the entry was written. */
  async readWithMeta<T>(name: string, maxAgeMs: number): Promise<{ value: T; savedAt: number } | undefined> {
    try {
      const raw = await readFile(this.pathFor(name), 'utf8');
      const parsed = JSON.parse(raw) as { savedAt: number; value: T };
      if (typeof parsed?.savedAt !== 'number' || parsed.value === undefined) return undefined;
      if (Date.now() - parsed.savedAt > maxAgeMs) return undefined;
      return { value: parsed.value, savedAt: parsed.savedAt };
    } catch {
      return undefined;
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    const path = this.pathFor(name);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ savedAt: Date.now(), value }), 'utf8');
    } catch {
      // A read-only or full disk should degrade to memory-only, not crash the server.
    }
  }
}
