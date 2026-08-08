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
 */

declare global {
  // eslint-disable-next-line no-var
  var __linkShortyStorage: Storage | undefined;
}

export function getStorage(): Storage {
  if (globalThis.__linkShortyStorage) {
    return globalThis.__linkShortyStorage;
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  let storage: Storage;
  if (url && token) {
    storage = new UpstashStorage(url, token);
  } else {
    storage = new MemoryStorage();
  }

  // Re-use across HMR reloads in dev to preserve state.
  globalThis.__linkShortyStorage = storage;
  return storage;
}

/**
 * Test helper: replace the singleton with a fresh in-memory store. Tests
 * call this in `beforeEach`. Not exported in production builds.
 */
export function __setStorage(storage: Storage): void {
  globalThis.__linkShortyStorage = storage;
}

/** Test helper: reset the singleton to auto-detect from env. */
export function __resetStorage(): void {
  delete globalThis.__linkShortyStorage;
}