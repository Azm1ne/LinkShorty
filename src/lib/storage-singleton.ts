import { MemoryStorage } from "./storage-memory";
import { UpstashStorage } from "./storage-upstash";
import type { Storage } from "./storage";

/**
 * Storage singleton. Picks Upstash when both required env vars are present,
 * otherwise uses an in-memory store (dev / tests). The Upstash REST client is
 * a singleton too — re-using the same instance across requests avoids
 * re-handshaking every call.
 *
 * In production: set KV_REST_API_URL and KV_REST_API_TOKEN. The Vercel
 * Marketplace integration for Upstash auto-injects these.
 *
 * In dev / tests: leave them unset. The in-memory store works for end-to-end
 * smoke testing against localhost. It does NOT persist across processes.
 *
 * Production safety: if KV env vars are missing in production, `buildStorage`
 * throws immediately rather than silently using MemoryStorage — that
 * fallback is stateful per Vercel function instance and would cause total
 * data loss between requests. We'd rather fail loud at the first storage
 * call than have the user discover it via lost links.
 */

declare global {
  var __linkShortyStorage: Storage | undefined;
}

/**
 * Pure factory: pick the right Storage given an env snapshot. Exported
 * separately so tests can drive it without mutating `process.env.NODE_ENV`
 * (which is non-configurable in modern Node).
 */
export function buildStorage(
  env: { NODE_ENV?: string; KV_REST_API_URL?: string; KV_REST_API_TOKEN?: string },
): Storage {
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    return new UpstashStorage(env.KV_REST_API_URL, env.KV_REST_API_TOKEN);
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "KV_REST_API_URL and KV_REST_API_TOKEN must be set in production " +
        "(provision Upstash via the Vercel Marketplace → Storage tab).",
    );
  }
  return new MemoryStorage();
}

export function getStorage(): Storage {
  if (globalThis.__linkShortyStorage) {
    return globalThis.__linkShortyStorage;
  }
  globalThis.__linkShortyStorage = buildStorage(process.env);
  return globalThis.__linkShortyStorage;
}

/**
 * Test helper: replace the singleton with a specific Storage instance.
 * Tests call this in `beforeEach` to get a clean in-memory store.
 */
export function setStorageForTests(storage: Storage): void {
  globalThis.__linkShortyStorage = storage;
}

/** Test helper: clear the singleton so the next `getStorage` re-detects. */
export function clearStorageForTests(): void {
  delete globalThis.__linkShortyStorage;
}
