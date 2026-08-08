import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage-memory";
import { checkRateLimit } from "./rate-limit";

const IP = "fake-ip-hash";

describe("checkRateLimit — create-expiring tier", () => {
  it("allows up to 20, rejects the 21st", async () => {
    const baseTime = 0;
    const storage = new MemoryStorage(() => baseTime);
    for (let i = 0; i < 20; i++) {
      const r = await checkRateLimit(storage, "create-expiring", IP);
      expect(r.ok).toBe(true);
    }
    const blocked = await checkRateLimit(storage, "create-expiring", IP);
    expect(blocked.ok).toBe(false);
  });

  it("rejected response carries a positive retryAfterSeconds", async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(storage, "create-expiring", IP);
    }
    const blocked = await checkRateLimit(storage, "create-expiring", IP);
    if (!blocked.ok) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3_600);
    } else {
      throw new Error("expected blocked response");
    }
  });

  it("window expires — counter resets after windowSeconds", async () => {
    let now = 0;
    const storage = new MemoryStorage(() => now);
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(storage, "create-expiring", IP);
    }
    // 21st blocked
    expect((await checkRateLimit(storage, "create-expiring", IP)).ok).toBe(
      false,
    );
    // Advance past the 1h window
    now = 3_600_000 + 1;
    // Counter rolled over — allowed again
    expect((await checkRateLimit(storage, "create-expiring", IP)).ok).toBe(
      true,
    );
  });
});

describe("checkRateLimit — create-permanent tier", () => {
  it("allows up to 5, rejects the 6th", async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(storage, "create-permanent", IP);
      expect(r.ok).toBe(true);
    }
    const blocked = await checkRateLimit(storage, "create-permanent", IP);
    expect(blocked.ok).toBe(false);
  });

  it("permanent window is 1 day", async () => {
    let now = 0;
    const storage = new MemoryStorage(() => now);
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(storage, "create-permanent", IP);
    }
    expect((await checkRateLimit(storage, "create-permanent", IP)).ok).toBe(
      false,
    );
    // Just shy of 24h — still blocked
    now = 86_400_000 - 1;
    expect((await checkRateLimit(storage, "create-permanent", IP)).ok).toBe(
      false,
    );
    // Past 24h — allowed
    now = 86_400_000 + 1;
    expect((await checkRateLimit(storage, "create-permanent", IP)).ok).toBe(
      true,
    );
  });
});

describe("checkRateLimit — slug-check tier", () => {
  it("allows up to 60, rejects the 61st", async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 60; i++) {
      const r = await checkRateLimit(storage, "slug-check", IP);
      expect(r.ok).toBe(true);
    }
    const blocked = await checkRateLimit(storage, "slug-check", IP);
    expect(blocked.ok).toBe(false);
  });
});

describe("checkRateLimit — isolation", () => {
  it("different IPs have independent counters", async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(storage, "slug-check", "ip-A");
    }
    expect((await checkRateLimit(storage, "slug-check", "ip-A")).ok).toBe(
      false,
    );
    // ip-B is fresh
    expect((await checkRateLimit(storage, "slug-check", "ip-B")).ok).toBe(
      true,
    );
  });

  it("different tiers have independent counters", async () => {
    const storage = new MemoryStorage();
    // Burn through the slug-check limit
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(storage, "slug-check", IP);
    }
    expect((await checkRateLimit(storage, "slug-check", IP)).ok).toBe(false);
    // create-expiring on the same IP is untouched
    expect((await checkRateLimit(storage, "create-expiring", IP)).ok).toBe(
      true,
    );
  });

  it("retryAfterSeconds decreases as the window drains", async () => {
    let now = 0;
    const storage = new MemoryStorage(() => now);
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(storage, "slug-check", IP);
    }
    const early = await checkRateLimit(storage, "slug-check", IP);
    if (!early.ok) {
      expect(early.retryAfterSeconds).toBeGreaterThan(3_500);
    } else {
      throw new Error("expected blocked");
    }
    // Half the window gone
    now = 1_800_000;
    const mid = await checkRateLimit(storage, "slug-check", IP);
    if (!mid.ok) {
      expect(mid.retryAfterSeconds).toBeLessThan(1_900);
      expect(mid.retryAfterSeconds).toBeGreaterThan(1_700);
    } else {
      throw new Error("expected blocked");
    }
  });
});