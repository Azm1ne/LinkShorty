/**
 * Tests for the Upstash-backed `Storage` implementation.
 *
 * The Upstash REST client is mocked here so we can exercise the wire-format
 * parsing that wouldn't otherwise be reachable in unit tests (the real
 * Upstash client requires network/credentials, and the original production
 * bug — the broken `zrevrange` parser — was only ever visible against real
 * Upstash).
 *
 * Mocking strategy: use the SDK's official `Requester` injection point.
 * Passing an object with a `request` method to `new Redis(...)` makes the
 * SDK use it as the transport layer, bypassing HTTP. We swap the
 * UpstashStorage's internal `Redis` instance after construction with one
 * backed by a mock requester.
 *
 * Behaviors locked down here:
 *   1. `zrevrange` parses Upstash's flat `[member, score, member, score, ...]`
 *      response. A single-member set must produce exactly one entry, not
 *      two `{member: "", score: 0}` garbage entries. (This was the original
 *      production bug.)
 *   2. `incrWithTtl` issues INCR + EXPIRE NX in a single multi-exec request,
 *      and consumes the `[count, ttlSet]` response shape correctly.
 *   3. The transaction methods (createLink/updateLink/deleteLink) batch
 *      multiple commands into one multi-exec and skip optional pieces
 *      when not provided.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { Redis } from "@upstash/redis";
import { UpstashStorage } from "./storage-upstash";

interface RecordedCall {
  path: string[];
  body: unknown;
}

let nextResponse: unknown = null;
const calls: RecordedCall[] = [];

beforeEach(() => {
  calls.length = 0;
  nextResponse = null;
});

/**
 * Build a `Redis` instance backed by a mock `Requester`. The Upstash SDK
 * exposes an official injection point: if you pass an object with a
 * `request` method to `new Redis(...)`, the SDK uses it directly without
 * going through the HTTP transport. This lets us intercept every command —
 * single commands, multi-exec batches, anything.
 *
 * Response shape contract:
 *   - For single-command paths (`req.path = ["zrange"]`, etc.), the SDK's
 *     `Command.exec()` calls `client.request()` and destructures
 *     `{ result, error }` from the response. So we return a single object.
 *   - For pipeline/multi-exec paths (`req.path = ["multi-exec"]` or
 *     `["pipeline"]`), the SDK's `Pipeline.exec()` calls `client.request()`
 *     and does `res.map(({ result, error }, i) => ...)`. So we return an
 *     array of `{result, error}` objects, one per queued command.
 *
 * We distinguish the two by checking whether `req.path[0]` is a known
 * pipeline endpoint.
 */
function makeStorage(): UpstashStorage {
  const requester = {
    request: async (req: { path?: string[]; body?: unknown }) => {
      calls.push({ path: req.path ?? [], body: req.body });
      const isPipeline =
        req.path && (req.path[0] === "multi-exec" || req.path[0] === "pipeline");

      if (isPipeline) {
        // `nextResponse` is an array of per-command results. Wrap each in
        // `{ result, error }`.
        const arr = Array.isArray(nextResponse) ? nextResponse : [nextResponse];
        return arr.map((r) => ({ result: r, error: null })) as never;
      }

      // Single-command path.
      return { result: nextResponse, error: null } as never;
    },
  };
  // Construct a mock Redis client via the official Requester injection point.
  const mockRedis = new Redis(requester);
  // Wrap in UpstashStorage normally, then swap the internal client.
  const storage = new UpstashStorage("https://example.com", "token");
  (storage as unknown as { client: Redis }).client = mockRedis;
  return storage;
}

// ---------------------------------------------------------------------------
// zrevrange
// ---------------------------------------------------------------------------

describe("UpstashStorage.zrevrange", () => {
  it("parses a single-member response as one entry, not two garbage entries", async () => {
    // Upstash's actual response shape for ZRANGE ... WITHSCORES with one
    // member is a flat array: [member, score].
    nextResponse = ["my-slug", 1754720965123];

    const storage = makeStorage();
    const result = await storage.zrevrange("links:index", 0, -1);

    // THE CORE REGRESSION: a single-member set must produce ONE entry.
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ member: "my-slug", score: 1754720965123 });
  });

  it("parses multi-member responses as interleaved [member, score, ...]", async () => {
    nextResponse = ["newer", 2000, "older", 1000];

    const storage = makeStorage();
    const result = await storage.zrevrange("links:index", 0, -1);

    expect(result).toEqual([
      { member: "newer", score: 2000 },
      { member: "older", score: 1000 },
    ]);
  });

  it("returns an empty array when the response is empty", async () => {
    nextResponse = [];

    const storage = makeStorage();
    const result = await storage.zrevrange("links:index", 0, -1);

    expect(result).toEqual([]);
  });

  it("returns an empty array when the response is null", async () => {
    nextResponse = null;

    const storage = makeStorage();
    const result = await storage.zrevrange("links:index", 0, -1);

    expect(result).toEqual([]);
  });

  it("ignores the trailing unpaired element of an odd-length flat array", async () => {
    // Defensive: if the upstream ever returns a malformed odd-length array,
    // we silently drop the trailing element rather than producing a
    // `{member: undefined, score: 0}` garbage entry.
    nextResponse = ["a", 1, "b"];

    const storage = makeStorage();
    const result = await storage.zrevrange("links:index", 0, -1);

    expect(result).toEqual([{ member: "a", score: 1 }]);
  });

  it("coerces score to number even when it's returned as a stringified number", async () => {
    // Defensive: real Upstash returns scores as JSON numbers, but we
    // should handle the case where some proxy returns stringified numbers.
    nextResponse = ["a", "1234"];

    const storage = makeStorage();
    const result = await storage.zrevrange("links:index", 0, -1);

    expect(result).toEqual([{ member: "a", score: 1234 }]);
  });
});

// ---------------------------------------------------------------------------
// incrWithTtl
// ---------------------------------------------------------------------------

describe("UpstashStorage.incrWithTtl", () => {
  it("issues INCR and EXPIRE NX in a single multi-exec transaction", async () => {
    // Upstash returns [count, ttlSet] — the array of deserialized results
    // for the commands in the order they were queued.
    nextResponse = [1, 1];

    const storage = makeStorage();
    const result = await storage.incrWithTtl("c", 60);

    // One multi-exec request …
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toEqual(["multi-exec"]);
    // … containing both commands in order. The SDK serializes numbers as
    // JSON numbers, not strings.
    const body = calls[0].body as unknown[];
    expect(body[0]).toEqual(["incr", "c"]);
    expect(body[1]).toEqual(["expire", "c", 60, "NX"]);
    // … and the response is correctly destructured.
    expect(result.count).toBe(1);
    expect(result.ttlSet).toBe(true);
  });

  it("reports ttlSet=false when EXPIRE NX did not set the TTL", async () => {
    // Counter already had a TTL → EXPIRE NX is a no-op, returns 0.
    nextResponse = [5, 0];

    const storage = makeStorage();
    const result = await storage.incrWithTtl("c", 60);

    expect(result.count).toBe(5);
    expect(result.ttlSet).toBe(false);
  });

  it("sends the NX flag as the third positional argument", async () => {
    // Defensive: NX must be exactly "NX" (the literal Upstash command flag),
    // not e.g. true/1. Otherwise the EXPIRE would unconditionally overwrite
    // any existing TTL — defeating the whole point of this fix.
    nextResponse = [1, 1];

    const storage = makeStorage();
    await storage.incrWithTtl("c", 60);

    const body = calls[0].body as unknown[];
    // The SDK serializes numbers as JSON numbers, not strings.
    expect(body[1]).toEqual(["expire", "c", 60, "NX"]);
  });
});

// ---------------------------------------------------------------------------
// Transaction methods
// ---------------------------------------------------------------------------

describe("UpstashStorage.createLinkTransaction", () => {
  it("queues hset, expireat, zadd, and token-index set then executes once", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.createLinkTransaction(
      "link:slug",
      { url: "https://example.com", createdAt: "1" },
      1234567890,
      "links:index",
      1,
      "slug",
      "tokens:index:abc",
      "slug",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toEqual(["multi-exec"]);
    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["hset", "expireat", "zadd", "set"]);
  });

  it("skips expireat when expireAtUnixSeconds is null", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.createLinkTransaction(
      "link:slug",
      { url: "https://example.com" },
      null,
      "links:index",
      1,
      "slug",
      null,
      null,
    );

    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["hset", "zadd"]);
  });

  it("skips the token-index set when tokenIndexKey is null", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.createLinkTransaction(
      "link:slug",
      { url: "https://example.com" },
      null,
      "links:index",
      1,
      "slug",
      null,
      null,
    );

    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).not.toContain("set");
  });
});

describe("UpstashStorage.updateLinkTransaction", () => {
  it("queues hset + expireat for fields + set-expiry", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.updateLinkTransaction(
      "link:s",
      { url: "u" },
      { type: "set", unixSeconds: 100 },
    );

    expect(calls).toHaveLength(1);
    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["hset", "expireat"]);
  });

  it("queues hset + persist for fields + clear-expiry", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.updateLinkTransaction(
      "link:s",
      { url: "u" },
      { type: "clear" },
    );

    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["hset", "persist"]);
  });

  it("queues only hset for fields-only update", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.updateLinkTransaction("link:s", { url: "u" }, null);

    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["hset"]);
  });

  it("queues only expireat for expiry-only update", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.updateLinkTransaction(
      "link:s",
      {},
      { type: "set", unixSeconds: 100 },
    );

    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["expireat"]);
  });

  it("does not call multi() at all when there's nothing to update", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.updateLinkTransaction("link:s", {}, null);

    // No-op: no multi-exec request issued.
    expect(calls).toHaveLength(0);
  });
});

describe("UpstashStorage.deleteLinkTransaction", () => {
  it("queues del + zrem + token-index del then executes once", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.deleteLinkTransaction("link:s", "links:index", "s", "tokens:index:abc");

    expect(calls).toHaveLength(1);
    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["del", "zrem", "del"]);
  });

  it("skips the token-index del when no tokenIndexKey is provided", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.deleteLinkTransaction("link:s", "links:index", "s", null);

    const body = calls[0].body as string[][];
    expect(body.map((c) => c[0])).toEqual(["del", "zrem"]);
  });
});

// ---------------------------------------------------------------------------
// Atomicity: the whole point of multi-exec is to batch commands.
// ---------------------------------------------------------------------------

describe("atomicity — multi-exec batching", () => {
  it("createLinkTransaction issues exactly ONE HTTP request, not three", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.createLinkTransaction(
      "link:slug",
      { url: "https://example.com", createdAt: "1" },
      1234567890,
      "links:index",
      1,
      "slug",
      "tokens:index:abc",
      "slug",
    );

    // The whole point of the fix: 4 commands in 1 round-trip, not 4.
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toEqual(["multi-exec"]);
  });

  it("updateLinkTransaction issues exactly ONE HTTP request", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.updateLinkTransaction(
      "link:s",
      { url: "u", expiresAt: "0" },
      { type: "clear" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toEqual(["multi-exec"]);
  });

  it("deleteLinkTransaction issues exactly ONE HTTP request", async () => {
    nextResponse = ["OK"];

    const storage = makeStorage();
    await storage.deleteLinkTransaction("link:s", "links:index", "s", "tokens:index:abc");

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toEqual(["multi-exec"]);
  });
});
