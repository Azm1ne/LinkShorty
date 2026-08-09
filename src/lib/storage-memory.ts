import type { CounterResult, Hash, IndexEntry, Storage } from "./storage";

interface HashEntry {
  value: Hash;
  expiresAt: number | null;
}

interface StringEntry {
  value: string;
  expiresAt: number | null;
}

interface ZsetEntry {
  /** member -> score */
  members: Map<string, number>;
  expiresAt: number | null;
}

/**
 * In-memory storage implementation. Mirrors only the operations the app uses.
 * Honors TTL via a monotonic clock. Cleared when the process exits — fine for
 * dev and tests; not used in production.
 *
 * Lazy expiry: expired entries are filtered on read, not swept in the
 * background. Matches Redis semantics well enough for our use cases — Redis
 * also doesn't promise synchronous cleanup of just-expired keys.
 */
export class MemoryStorage implements Storage {
  private hashes = new Map<string, HashEntry>();
  private strings = new Map<string, StringEntry>();
  private zsets = new Map<string, ZsetEntry>();

  constructor(private now: () => number = () => Date.now()) {}

  /** Test helper: reset all state. */
  clear(): void {
    this.hashes.clear();
    this.strings.clear();
    this.zsets.clear();
  }

  /** Test helper: advance the clock. */
  advance(ms: number): void {
    this.fakeNow += ms;
  }
  private fakeNow = 0;
  private get time(): number {
    return this.fakeNow > 0 ? this.fakeNow : this.now();
  }

  private isExpired(expiresAt: number | null): boolean {
    return expiresAt !== null && this.time >= expiresAt;
  }

  // --- Hashes ---

  async hgetall(key: string): Promise<Hash | null> {
    const entry = this.hashes.get(key);
    if (!entry || this.isExpired(entry.expiresAt)) return null;
    return { ...entry.value };
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    const existing = this.hashes.get(key);
    if (existing && this.isExpired(existing.expiresAt)) {
      this.hashes.delete(key);
    }
    const entry = this.hashes.get(key) ?? { value: {}, expiresAt: null };
    entry.value[field] = value;
    this.hashes.set(key, entry);
  }

  async hsetMany(key: string, fields: Record<string, string>): Promise<void> {
    const existing = this.hashes.get(key);
    if (existing && this.isExpired(existing.expiresAt)) {
      this.hashes.delete(key);
    }
    const entry = this.hashes.get(key) ?? { value: {}, expiresAt: null };
    for (const [field, value] of Object.entries(fields)) {
      entry.value[field] = value;
    }
    this.hashes.set(key, entry);
  }

  async hdel(key: string, field: string): Promise<void> {
    const entry = this.hashes.get(key);
    if (!entry || this.isExpired(entry.expiresAt)) return;
    delete entry.value[field];
  }

  async exists(key: string): Promise<boolean> {
    if (this.hashes.has(key)) {
      const entry = this.hashes.get(key)!;
      if (this.isExpired(entry.expiresAt)) {
        this.hashes.delete(key);
        return false;
      }
      return true;
    }
    if (this.strings.has(key)) {
      const entry = this.strings.get(key)!;
      if (this.isExpired(entry.expiresAt)) {
        this.strings.delete(key);
        return false;
      }
      return true;
    }
    if (this.zsets.has(key)) {
      const entry = this.zsets.get(key)!;
      if (this.isExpired(entry.expiresAt)) {
        this.zsets.delete(key);
        return false;
      }
      return true;
    }
    return false;
  }

  async del(key: string): Promise<void> {
    this.hashes.delete(key);
    this.strings.delete(key);
    this.zsets.delete(key);
  }

  // --- TTLs ---

  async expireAt(key: string, unixSeconds: number): Promise<void> {
    const ms = unixSeconds * 1000;
    this.applyTtl(key, ms);
  }

  async clearExpiry(key: string): Promise<void> {
    if (this.hashes.has(key)) {
      this.hashes.get(key)!.expiresAt = null;
    } else if (this.strings.has(key)) {
      this.strings.get(key)!.expiresAt = null;
    } else if (this.zsets.has(key)) {
      this.zsets.get(key)!.expiresAt = null;
    }
  }

  async ttl(key: string): Promise<number | null> {
    const expiresAt = this.findExpiresAt(key);
    if (expiresAt === null) return null;
    const remaining = Math.ceil((expiresAt - this.time) / 1000);
    return remaining > 0 ? remaining : null;
  }

  private applyTtl(key: string, ms: number): void {
    if (this.hashes.has(key)) {
      this.hashes.get(key)!.expiresAt = ms;
    } else if (this.strings.has(key)) {
      this.strings.get(key)!.expiresAt = ms;
    } else if (this.zsets.has(key)) {
      this.zsets.get(key)!.expiresAt = ms;
    }
  }

  private findExpiresAt(key: string): number | null {
    for (const map of [this.hashes, this.strings, this.zsets]) {
      const entry = map.get(key);
      if (entry) return entry.expiresAt;
    }
    return null;
  }

  // --- Strings ---

  async get(key: string): Promise<string | null> {
    const entry = this.strings.get(key);
    if (!entry || this.isExpired(entry.expiresAt)) return null;
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    opts?: { exSeconds?: number; nx?: boolean },
  ): Promise<boolean> {
    const existing = this.strings.get(key);
    if (opts?.nx && existing && !this.isExpired(existing.expiresAt)) {
      return false;
    }
    const expiresAt = opts?.exSeconds
      ? this.time + opts.exSeconds * 1000
      : null;
    this.strings.set(key, { value, expiresAt });
    return true;
  }

  // --- Counters ---

  async incr(key: string): Promise<number> {
    const existing = this.strings.get(key);
    if (existing && this.isExpired(existing.expiresAt)) {
      this.strings.delete(key);
    }
    const current = this.strings.get(key);
    const currentValue = current ? parseInt(current.value, 10) || 0 : 0;
    const next = currentValue + 1;
    this.strings.set(key, {
      value: String(next),
      expiresAt: current?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, seconds: number, nx?: boolean): Promise<boolean> {
    const entry = this.strings.get(key);
    if (!entry) return false;
    if (nx && entry.expiresAt !== null) return false;
    entry.expiresAt = this.time + seconds * 1000;
    return true;
  }

  async incrWithTtl(key: string, windowSeconds: number): Promise<CounterResult> {
    const existing = this.strings.get(key);
    const wasExpired = !existing || this.isExpired(existing.expiresAt);
    const count = await this.incr(key);
    // Set TTL only if the counter didn't already have one — mimics EXPIRE NX.
    const ttlSet = wasExpired
      ? await this.expire(key, windowSeconds, true)
      : false;
    return { count, ttlSet };
  }

  // --- Sorted sets ---

  async zadd(key: string, score: number, member: string): Promise<void> {
    const existing = this.zsets.get(key);
    if (existing && this.isExpired(existing.expiresAt)) {
      this.zsets.delete(key);
    }
    const entry = this.zsets.get(key) ?? { members: new Map(), expiresAt: null };
    entry.members.set(member, score);
    this.zsets.set(key, entry);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<IndexEntry[]> {
    const entry = this.zsets.get(key);
    if (!entry || this.isExpired(entry.expiresAt)) return [];
    const sorted = [...entry.members.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([member, score]) => ({ member, score }));
    // Redis ZREVRANGE uses inclusive indices; -1 means "to the end".
    const realStop = stop === -1 ? sorted.length - 1 : stop;
    return sorted.slice(start, realStop + 1);
  }

  async zrangebylex(
    key: string,
    min: string,
    max: string,
    limit?: number,
  ): Promise<string[]> {
    const entry = this.zsets.get(key);
    if (!entry || this.isExpired(entry.expiresAt)) return [];
    // Match members lexically within [min, max].
    // min/max use Redis bracket notation: [ = inclusive, ( = exclusive.
    const stripBracket = (s: string) => {
      const bracket = s[0];
      const value = s.slice(1);
      return { value, inclusive: bracket === "[" };
    };
    const lo = stripBracket(min);
    const hi = stripBracket(max);
    const matches: string[] = [];
    for (const member of entry.members.keys()) {
      const aboveMin = lo.inclusive ? member >= lo.value : member > lo.value;
      const belowMax = hi.inclusive ? member <= hi.value : member < hi.value;
      if (aboveMin && belowMax) matches.push(member);
    }
    matches.sort();
    return limit !== undefined ? matches.slice(0, limit) : matches;
  }

  async zcard(key: string): Promise<number> {
    const entry = this.zsets.get(key);
    if (!entry || this.isExpired(entry.expiresAt)) return 0;
    return entry.members.size;
  }

  async zrem(key: string, member: string): Promise<void> {
    const entry = this.zsets.get(key);
    if (!entry || this.isExpired(entry.expiresAt)) return;
    entry.members.delete(member);
  }

  // --- Bulk ---

  async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  // --- Transactions ---
  // The in-memory store is process-local and effectively atomic within a
  // single request, so each transaction method just delegates to the existing
  // helpers in the same order. Order mirrors the Upstash `multi()` payload so
  // both implementations behave the same when interleaving with concurrent
  // reads on the same client.

  async createLinkTransaction(
    hashKey: string,
    fields: Record<string, string>,
    expireAtUnixSeconds: number | null,
    indexKey: string,
    score: number,
    member: string,
    tokenIndexKey: string | null,
    tokenIndexValue: string | null,
  ): Promise<void> {
    await this.hsetMany(hashKey, fields);
    if (expireAtUnixSeconds !== null) {
      await this.expireAt(hashKey, expireAtUnixSeconds);
    }
    await this.zadd(indexKey, score, member);
    if (tokenIndexKey && tokenIndexValue) {
      await this.set(tokenIndexKey, tokenIndexValue);
    }
  }

  async updateLinkTransaction(
    hashKey: string,
    fields: Record<string, string>,
    expiry: { type: "set"; unixSeconds: number } | { type: "clear" } | null,
  ): Promise<void> {
    if (Object.keys(fields).length > 0) {
      await this.hsetMany(hashKey, fields);
    }
    if (expiry?.type === "set") {
      await this.expireAt(hashKey, expiry.unixSeconds);
    } else if (expiry?.type === "clear") {
      await this.clearExpiry(hashKey);
    }
  }

  async deleteLinkTransaction(
    hashKey: string,
    indexKey: string,
    member: string,
    tokenIndexKey: string | null,
  ): Promise<void> {
    await this.del(hashKey);
    await this.zrem(indexKey, member);
    if (tokenIndexKey) {
      await this.del(tokenIndexKey);
    }
  }
}