import { describe, expect, it } from "vitest";
import {
  generateToken,
  hashEditToken,
  hashIp,
  hashPassword,
  verifyPassword,
} from "./hash";

describe("hashIp", () => {
  it("returns a 64-char hex string", async () => {
    const hash = await hashIp("1.2.3.4", "salt");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    const a = await hashIp("1.2.3.4", "salt");
    const b = await hashIp("1.2.3.4", "salt");
    expect(a).toBe(b);
  });

  it("changes when the salt changes", async () => {
    const a = await hashIp("1.2.3.4", "salt-1");
    const b = await hashIp("1.2.3.4", "salt-2");
    expect(a).not.toBe(b);
  });
});

describe("hashEditToken", () => {
  it("is a 64-char hex string", async () => {
    const hash = await hashEditToken("token-123");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", async () => {
    const a = await hashEditToken("token-123");
    const b = await hashEditToken("token-123");
    expect(a).toBe(b);
  });
});

describe("hashPassword (Argon2id)", () => {
  it("produces a standard Argon2id PHC string", async () => {
    const h = await hashPassword("hunter2", "slug-a");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it("uses a different salt on each call (so hashes are unique)", async () => {
    const a = await hashPassword("hunter2", "slug-a");
    const b = await hashPassword("hunter2", "slug-a");
    expect(a).not.toBe(b);
  });

  it("produces different hashes for the same password on different slugs", async () => {
    // Argon2id's per-hash salt already covers this — but the contract
    // should still hold even if slug eventually participates in the hash.
    const a = await hashPassword("hunter2", "slug-a");
    const b = await hashPassword("hunter2", "slug-b");
    expect(a).not.toBe(b);
  });

  it("produces different hashes for different passwords", async () => {
    const a = await hashPassword("hunter2", "slug-a");
    const b = await hashPassword("correct horse", "slug-a");
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("returns true for the correct password", async () => {
    const stored = await hashPassword("hunter2", "slug-a");
    expect(await verifyPassword("hunter2", stored, "slug-a")).toBe(true);
  });

  it("returns false for the wrong password", async () => {
    const stored = await hashPassword("hunter2", "slug-a");
    expect(await verifyPassword("wrong", stored, "slug-a")).toBe(false);
  });

  it("returns false when the slug doesn't match", async () => {
    // The slug is bound into the prehash, so the same password under a
    // different slug must not verify. This is the domain-separation guarantee.
    const stored = await hashPassword("hunter2", "slug-a");
    expect(await verifyPassword("hunter2", stored, "slug-b")).toBe(false);
  });

  it("returns false for a malformed stored hash", async () => {
    expect(await verifyPassword("hunter2", "not-an-argon2-hash", "slug-a")).toBe(false);
  });
});

describe("generateToken", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const t = generateToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns unique values across calls", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});