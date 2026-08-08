import { describe, expect, it } from "vitest";
import { generateToken, hashEditToken, hashIp, hashPassword } from "./hash";

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

describe("hashPassword", () => {
  it("produces different hashes for same password on different slugs", async () => {
    const a = await hashPassword("hunter2", "slug-a");
    const b = await hashPassword("hunter2", "slug-b");
    expect(a).not.toBe(b);
  });

  it("is deterministic", async () => {
    const a = await hashPassword("hunter2", "slug-a");
    const b = await hashPassword("hunter2", "slug-a");
    expect(a).toBe(b);
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