/**
 * Tiered rate limits, sized by the cost of the action.
 *
 * Each tier uses the storage primitive `incrWithTtl` which performs
 * `INCR` + `EXPIRE ... NX` in one call. The `NX` flag is critical: without
 * it, EXPIRE would *reset* the TTL on every increment, and the window would
 * never roll over — the limit would never fire.
 *
 * Counters are keyed `rate:{type}:{ipHash}` where ipHash is SHA-256(ip + IP_SALT).
 * Raw IPs are never written to storage.
 */

import type { Storage } from "./storage";

export type RateLimitType =
  | "create-expiring"
  | "create-permanent"
  | "slug-check"
  | "admin-login";

interface TierConfig {
  key: string;
  limit: number;
  windowSeconds: number;
}

const TIER_CONFIG: Record<RateLimitType, TierConfig> = {
  "create-expiring": {
    key: "rate:create-expiring",
    limit: 20,
    windowSeconds: 3_600, // 1 hour
  },
  "create-permanent": {
    key: "rate:create-permanent",
    limit: 5,
    windowSeconds: 86_400, // 1 day
  },
  "slug-check": {
    key: "rate:slug-check",
    limit: 60,
    windowSeconds: 3_600, // 1 hour
  },
  "admin-login": {
    key: "rate:admin-login",
    limit: 5,
    windowSeconds: 900, // 15 minutes
  },
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Increment the rate-limit counter for the given (type, ipHash) and decide
 * whether the request is allowed. Returns `{ ok: false, retryAfterSeconds }`
 * when the request would exceed the tier's limit.
 *
 * Increments BEFORE checking, so the N+1th request is the one that fails.
 * That matches the spec: 21st attempt in an hour → 429.
 */
export async function checkRateLimit(
  storage: Storage,
  type: RateLimitType,
  ipHash: string,
): Promise<RateLimitResult> {
  const config = TIER_CONFIG[type];
  const key = `${config.key}:${ipHash}`;

  const { count } = await storage.incrWithTtl(key, config.windowSeconds);

  if (count <= config.limit) {
    return { ok: true };
  }

  // Over the limit. Tell the client how long to wait.
  const ttl = await storage.ttl(key);
  // Defensive fallback: if the TTL read races (e.g. key just expired),
  // use a sensible default so the client never gets -1.
  const retryAfterSeconds = ttl !== null && ttl > 0 ? ttl : 60;
  return { ok: false, retryAfterSeconds };
}

/**
 * Build a rate-limit 429 response, including the `Retry-After` header.
 * Exposed so route handlers can return consistent error envelopes.
 */
export function rateLimitResponse(
  retryAfterSeconds: number,
  type: RateLimitType,
): Response {
  return new Response(
    JSON.stringify({
      error: "rate-limited",
      type,
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}
