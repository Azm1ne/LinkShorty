import { Redis } from "@upstash/redis";
import type { CounterResult, Hash, IndexEntry, Storage } from "./storage";

/**
 * Upstash Redis adapter. Uses the REST API so it works on Edge runtime.
 *
 * The ZRANGEBYLEX semantics here are simplified: we assume the caller passes
 * a `min`/`max` pair that represents a slug prefix scan. We use ZRANGEBYLEX
 * with the `+` / `-` sentinels as appropriate.
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
    const result = await this.r.hgetall(key);
    if (!result) return null;
    // Upstash returns hashes as a plain object Record<string, string>
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
    // Build the SET args. Upstash's `set` accepts an `ex` and `nx` option.
    const result = await this.r.set(key, value, {
      ...(opts?.exSeconds !== undefined ? { ex: opts.exSeconds } : {}),
      ...(opts?.nx ? { nx: true } : {}),
    });
    return result === "OK" || result === true;
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
    // Upstash: ZRANGE with REV returns members; we need scores.
    const withScores = await this.r.zrange(key, start, stop, {
      rev: true,
      withScores: true,
    });
    if (!Array.isArray(withScores)) return [];
    return withScores.map((entry) => {
      if (Array.isArray(entry) && entry.length === 2) {
        return { member: String(entry[0]), score: Number(entry[1]) };
      }
      // Fallback if format is unexpected
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
    const opts = limit !== undefined ? { limit } : {};
    const result = await this.r.zrangebylex(key, min, max, opts);
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