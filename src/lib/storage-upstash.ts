import { Redis } from "@upstash/redis";
import type { CounterResult, Hash, IndexEntry, Storage } from "./storage";

/**
 * Upstash Redis adapter. Uses the REST API so it works on Edge runtime.
 *
 * The `links:index` sorted set is used for the admin list. For slug prefix
 * search, we use `zrange` with lex bounds (Upstash supports this via the
 * `[string` / `(string` syntax).
 */
export class UpstashStorage implements Storage {
  private client: Redis;

  constructor(url: string, token: string) {
    this.client = new Redis({ url, token });
  }

  private get r(): Redis {
    return this.client;
  }

  async hgetall(key: string): Promise<Hash | null> {
    const result = await this.r.hgetall<Hash>(key);
    if (!result) return null;
    return result as Hash;
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.r.hset(key, { [field]: value });
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.r.hdel(key, field);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.r.exists(key);
    return result > 0;
  }

  async del(key: string): Promise<void> {
    await this.r.del(key);
  }

  async expireAt(key: string, unixSeconds: number): Promise<void> {
    await this.r.expireat(key, unixSeconds);
  }

  async clearExpiry(key: string): Promise<void> {
    // PERSIST removes the TTL but keeps the key (Redis 2.6+).
    await this.r.persist(key);
  }

  async ttl(key: string): Promise<number | null> {
    const result = await this.r.ttl(key);
    if (result === -1 || result === -2) return null;
    return result;
  }

  async get(key: string): Promise<string | null> {
    const result = await this.r.get<string>(key);
    return result ?? null;
  }

  async set(
    key: string,
    value: string,
    opts?: { exSeconds?: number; nx?: boolean },
  ): Promise<boolean> {
    // The Upstash typing for `set` requires all of ex/px/etc to be specified
    // together. We assemble the right shape based on which flags are set.
    // NX mode: returns "OK" on success, null when NX blocked the write.
    // Plain mode: always returns "OK".
    if (opts?.nx && opts.exSeconds !== undefined) {
      const result = await this.r.set(key, value, { nx: true, ex: opts.exSeconds });
      return result !== null;
    }
    if (opts?.nx) {
      const result = await this.r.set(key, value, { nx: true });
      return result !== null;
    }
    if (opts?.exSeconds !== undefined) {
      const result = await this.r.set(key, value, { ex: opts.exSeconds });
      return result !== null;
    }
    const result = await this.r.set(key, value);
    return result !== null;
  }

  async incr(key: string): Promise<number> {
    return this.r.incr(key);
  }

  async expire(key: string, seconds: number, nx?: boolean): Promise<boolean> {
    const result = await this.r.expire(key, seconds, nx ? "NX" : undefined);
    return result === 1;
  }

  async incrWithTtl(key: string, windowSeconds: number): Promise<CounterResult> {
    const count = await this.r.incr(key);
    const ttlSet = await this.r.expire(key, windowSeconds, "NX");
    return { count, ttlSet: ttlSet === 1 };
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.r.zadd(key, { score, member });
  }

  async zrevrange(key: string, start: number, stop: number): Promise<IndexEntry[]> {
    const withScores = await this.r.zrange(key, start, stop, {
      rev: true,
      withScores: true,
    });
    if (!Array.isArray(withScores)) return [];
    return withScores.map((entry) => {
      if (Array.isArray(entry) && entry.length === 2) {
        return { member: String(entry[0]), score: Number(entry[1]) };
      }
      const obj = entry as { member?: string; score?: number };
      return { member: String(obj.member ?? ""), score: Number(obj.score ?? 0) };
    });
  }

  async zrangebylex(
    key: string,
    min: string,
    max: string,
    limit?: number,
  ): Promise<string[]> {
    // Upstash uses ZRANGE with lex bounds; the second overload accepts
    // `[string` / `(string` / `-` / `+` values for min/max.
    const opts: { byLex: true; limit?: number } = { byLex: true };
    if (limit !== undefined) opts.limit = limit;
    const mins = min as `[${string}` | `(${string}` | "-" | "+";
    const maxs = max as `[${string}` | `(${string}` | "-" | "+";
    const result = await this.r.zrange(key, mins, maxs, opts);
    return Array.isArray(result) ? result.map(String) : [];
  }

  async zcard(key: string): Promise<number> {
    return this.r.zcard(key);
  }

  async zrem(key: string, member: string): Promise<void> {
    await this.r.zrem(key, member);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    const result = await this.r.mget<string[]>(...keys);
    return result.map((v) => (v == null ? null : String(v)));
  }
}