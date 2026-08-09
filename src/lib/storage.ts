/**
 * Storage abstraction over Redis.
 *
 * Production uses Upstash Redis via the @upstash/redis client (REST, Edge-compatible).
 * Local dev and tests use a small in-memory implementation with TTL semantics.
 *
 * The interface intentionally mirrors only the operations the app needs — no
 * generic Redis passthrough. New operations get a typed method here, not a
 * raw passthrough, so the call sites stay narrow and testable.
 */

/** A typed hash entry. Upstash returns strings for both fields and values. */
export type Hash = Record<string, string>;

/** Result of ZREVRANGE: members newest-first, with their scores. */
export interface IndexEntry {
  member: string;
  score: number;
}

/** Single counter increment + optional TTL set. */
export interface CounterResult {
  count: number;
  /** True if EXPIRE set a TTL (i.e. NX fired). Used to know whether the window started now. */
  ttlSet: boolean;
}

/** The full storage surface the app uses. */
export interface Storage {
  // Hashes (link:{slug})
  hgetall(key: string): Promise<Hash | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  /**
   * Multi-field HSET — sets several fields on a hash in one round-trip. The
   * `MemoryStorage` implementation writes each field separately so test
   * semantics match the per-field helper; `UpstashStorage` uses the real
   * `HSET key f1 v1 f2 v2 ...` shape so the wire cost is one HTTP call.
   */
  hsetMany(key: string, fields: Record<string, string>): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  del(key: string): Promise<void>;

  // TTLs
  expireAt(key: string, unixSeconds: number): Promise<void>;
  /** Remove any TTL from the key. The key survives. */
  clearExpiry(key: string): Promise<void>;
  /** Seconds until key expires, or null if no TTL or key doesn't exist. */
  ttl(key: string): Promise<number | null>;

  // Strings (small values)
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts?: { exSeconds?: number; nx?: boolean },
  ): Promise<boolean>;

  // Counters (rate limits)
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number, nx?: boolean): Promise<boolean>;
  /**
   * Convenience: INCR + EXPIRE NX in one call. Returns the count after increment
   * and whether this call was the one that started the window.
   */
  incrWithTtl(key: string, windowSeconds: number): Promise<CounterResult>;

  // Sorted sets (links:index)
  zadd(key: string, score: number, member: string): Promise<void>;
  zrevrange(key: string, start: number, stop: number): Promise<IndexEntry[]>;
  zrangebylex(key: string, min: string, max: string, limit?: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  zrem(key: string, member: string): Promise<void>;

  // Bulk
  mget(keys: string[]): Promise<(string | null)[]>;

  // Transactions
  /**
   * Atomically HSET fields, optionally EXPIREAT, ZADD into an index, and SET
   * a reverse-lookup value — used by createLink so a partial failure can't
   * leave the link visible but not in the index (or vice versa).
   *
   * `tokenIndexKey` / `tokenIndexValue` are optional; when both are non-null,
   * a reverse-lookup `SET tokenIndexKey tokenIndexValue` is included in the
   * same transaction so the edit-token → slug map is consistent with the
   * link's hash.
   */
  createLinkTransaction(
    hashKey: string,
    fields: Record<string, string>,
    expireAtUnixSeconds: number | null,
    indexKey: string,
    score: number,
    member: string,
    tokenIndexKey: string | null,
    tokenIndexValue: string | null,
  ): Promise<void>;

  /**
   * Atomically HSET fields and set/clear the TTL — used by updateLink so a
   * partial failure can't leave (e.g.) previousUrl pointing at the same URL.
   */
  updateLinkTransaction(
    hashKey: string,
    fields: Record<string, string>,
    expiry: { type: "set"; unixSeconds: number } | { type: "clear" } | null,
  ): Promise<void>;

  /**
   * Atomically DEL a hash, ZREM its index entry, and DEL the tokens:index
   * reverse-lookup — used by deleteLink so the link's hash, index, and
   * edit-token map are cleaned up together.
   */
  deleteLinkTransaction(
    hashKey: string,
    indexKey: string,
    member: string,
    tokenIndexKey: string | null,
  ): Promise<void>;
}