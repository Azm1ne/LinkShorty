import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage-memory";

describe("MemoryStorage", () => {
  it("round-trips a value through set/get", async () => {
    const s = new MemoryStorage();
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
  });

  it("returns null for missing keys", async () => {
    const s = new MemoryStorage();
    expect(await s.get("nope")).toBeNull();
  });

  it("set with NX returns false when key already exists", async () => {
    const s = new MemoryStorage();
    await s.set("k", "first");
    expect(await s.set("k", "second", { nx: true })).toBe(false);
    expect(await s.get("k")).toBe("first");
  });

  it("set with NX returns true when key is new", async () => {
    const s = new MemoryStorage();
    expect(await s.set("k", "v", { nx: true })).toBe(true);
    expect(await s.get("k")).toBe("v");
  });

  it("expires values via expireAt", async () => {
    let now = 0;
    const s = new MemoryStorage(() => now);
    await s.set("k", "v");
    await s.expireAt("k", 5); // expires at unix-second 5
    expect(await s.get("k")).toBe("v");
    now = 4_999;
    expect(await s.get("k")).toBe("v");
    now = 5_001;
    expect(await s.get("k")).toBeNull();
  });

  it("expires values via TTL set on string", async () => {
    let now = 0;
    const s = new MemoryStorage(() => now);
    await s.set("k", "v", { exSeconds: 10 });
    expect(await s.ttl("k")).toBe(10);
    now = 5_000;
    expect(await s.ttl("k")).toBe(5);
    now = 11_000;
    expect(await s.get("k")).toBeNull();
  });

  it("hashes store and retrieve fields", async () => {
    const s = new MemoryStorage();
    await s.hset("h", "a", "1");
    await s.hset("h", "b", "2");
    expect(await s.hgetall("h")).toEqual({ a: "1", b: "2" });
  });

  it("hdel removes a single field", async () => {
    const s = new MemoryStorage();
    await s.hset("h", "a", "1");
    await s.hset("h", "b", "2");
    await s.hdel("h", "a");
    expect(await s.hgetall("h")).toEqual({ b: "2" });
  });

  it("hash TTL via expireAt causes later reads to return null", async () => {
    let now = 0;
    const s = new MemoryStorage(() => now);
    await s.hset("h", "a", "1");
    await s.expireAt("h", 100);
    expect(await s.hgetall("h")).toEqual({ a: "1" });
    now = 100_001;
    expect(await s.hgetall("h")).toBeNull();
  });

  it("incr returns successive counts", async () => {
    const s = new MemoryStorage();
    expect(await s.incr("c")).toBe(1);
    expect(await s.incr("c")).toBe(2);
    expect(await s.incr("c")).toBe(3);
  });

  it("incrWithTtl sets TTL only on the first call", async () => {
    let now = 0;
    const s = new MemoryStorage(() => now);
    const r1 = await s.incrWithTtl("c", 60);
    expect(r1.count).toBe(1);
    expect(r1.ttlSet).toBe(true);
    const r2 = await s.incrWithTtl("c", 60);
    expect(r2.count).toBe(2);
    expect(r2.ttlSet).toBe(false);
    // Verify the counter is still alive after the original window
    now = 30_000;
    const r3 = await s.incrWithTtl("c", 60);
    expect(r3.count).toBe(3);
    expect(r3.ttlSet).toBe(false);
  });

  it("incrWithTtl restarts the window when the previous one expired", async () => {
    let now = 0;
    const s = new MemoryStorage(() => now);
    await s.incrWithTtl("c", 60);
    now = 70_000; // past the window
    const r = await s.incrWithTtl("c", 60);
    expect(r.count).toBe(1); // counter was gone, started fresh
    expect(r.ttlSet).toBe(true);
  });

  it("expire NX on a key without TTL succeeds", async () => {
    const s = new MemoryStorage();
    await s.set("k", "v");
    expect(await s.expire("k", 30, true)).toBe(true);
  });

  it("expire NX on a key with TTL fails", async () => {
    const s = new MemoryStorage();
    await s.set("k", "v", { exSeconds: 30 });
    expect(await s.expire("k", 60, true)).toBe(false);
  });

  it("sorted set ZADD then ZREVRANGE returns newest-first", async () => {
    const s = new MemoryStorage();
    await s.zadd("z", 1, "a");
    await s.zadd("z", 3, "c");
    await s.zadd("z", 2, "b");
    const out = await s.zrevrange("z", 0, -1);
    expect(out).toEqual([
      { member: "c", score: 3 },
      { member: "b", score: 2 },
      { member: "a", score: 1 },
    ]);
  });

  it("ZREVRANGE respects start and stop indices", async () => {
    const s = new MemoryStorage();
    await s.zadd("z", 1, "a");
    await s.zadd("z", 2, "b");
    await s.zadd("z", 3, "c");
    expect(await s.zrevrange("z", 0, 1)).toEqual([
      { member: "c", score: 3 },
      { member: "b", score: 2 },
    ]);
  });

  it("ZRANGEBYLEX filters by slug prefix with inclusive bounds", async () => {
    const s = new MemoryStorage();
    await s.zadd("z", 1, "alpha");
    await s.zadd("z", 2, "apple");
    await s.zadd("z", 3, "apricot");
    await s.zadd("z", 4, "banana");
    const out = await s.zrangebylex("z", "[ap", "[ar");
    expect(out).toEqual(["apple", "apricot"]);
  });

  it("ZRANGEBYLEX respects the limit option", async () => {
    const s = new MemoryStorage();
    await s.zadd("z", 1, "a1");
    await s.zadd("z", 2, "a2");
    await s.zadd("z", 3, "a3");
    const out = await s.zrangebylex("z", "[a", "[z", 2);
    expect(out).toEqual(["a1", "a2"]);
  });

  it("ZCARD returns size, ZREM removes a member", async () => {
    const s = new MemoryStorage();
    await s.zadd("z", 1, "a");
    await s.zadd("z", 2, "b");
    expect(await s.zcard("z")).toBe(2);
    await s.zrem("z", "a");
    expect(await s.zcard("z")).toBe(1);
  });

  it("MGET returns values for multiple keys, null for missing", async () => {
    const s = new MemoryStorage();
    await s.set("a", "1");
    await s.set("b", "2");
    expect(await s.mget(["a", "b", "c"])).toEqual(["1", "2", null]);
  });

  it("EXISTS finds any key type", async () => {
    const s = new MemoryStorage();
    await s.set("str", "v");
    await s.hset("h", "f", "v");
    await s.zadd("z", 1, "m");
    expect(await s.exists("str")).toBe(true);
    expect(await s.exists("h")).toBe(true);
    expect(await s.exists("z")).toBe(true);
    expect(await s.exists("missing")).toBe(false);
  });

  it("DEL removes all key types", async () => {
    const s = new MemoryStorage();
    await s.set("str", "v");
    await s.hset("h", "f", "v");
    await s.zadd("z", 1, "m");
    await s.del("str");
    await s.del("h");
    await s.del("z");
    expect(await s.exists("str")).toBe(false);
    expect(await s.exists("h")).toBe(false);
    expect(await s.exists("z")).toBe(false);
  });
});