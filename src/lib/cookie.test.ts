import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signCookie, verifyCookie } from "./cookie";

const ORIGINAL_SECRET = process.env.COOKIE_SECRET;

beforeEach(() => {
  process.env.COOKIE_SECRET = "test-secret-32-bytes-long-please";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.COOKIE_SECRET;
  } else {
    process.env.COOKIE_SECRET = ORIGINAL_SECRET;
  }
});

describe("signCookie / verifyCookie", () => {
  it("round-trips a future-dated grant", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires);
    const decoded = await verifyCookie(raw);
    expect(decoded).toEqual({ slug: "hello", expiresAtMs: expires });
  });

  it("rejects an already-expired grant", async () => {
    const expires = Date.now() - 1000;
    const raw = await signCookie("hello", expires);
    // signCookie doesn't enforce a future date; verify does.
    expect(await verifyCookie(raw)).toBeNull();
  });

  it("rejects a tampered slug", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires);
    // Swap slug for something else, keep the original signature.
    const parts = raw.split("|");
    parts[0] = "goodbye";
    const tampered = parts.join("|");
    expect(await verifyCookie(tampered)).toBeNull();
  });

  it("rejects a tampered expiresAt", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires);
    // Bump the expiry so the original HMAC no longer matches.
    const parts = raw.split("|");
    parts[1] = String(Number(parts[1]) + 1_000_000);
    const tampered = parts.join("|");
    expect(await verifyCookie(tampered)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires);
    // Flip the last character of the signature.
    const last = raw[raw.length - 1];
    const flipped = last === "0" ? "1" : "0";
    const tampered = raw.slice(0, -1) + flipped;
    expect(await verifyCookie(tampered)).toBeNull();
  });

  it("rejects when signed with a different secret", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires);
    // Rotate the secret used for verification.
    process.env.COOKIE_SECRET = "totally-different-secret-32-bytes-x";
    expect(await verifyCookie(raw)).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await verifyCookie("")).toBeNull();
    expect(await verifyCookie("just-slug")).toBeNull();
    expect(await verifyCookie("slug|exp")).toBeNull();
    expect(await verifyCookie("slug|not-a-number|sig")).toBeNull();
    expect(await verifyCookie("|||sig")).toBeNull();
  });

  it("rejects when COOKIE_SECRET is unset", async () => {
    delete process.env.COOKIE_SECRET;
    const expires = Date.now() + 60_000;
    // signCookie throws when secret is missing.
    await expect(signCookie("hello", expires)).rejects.toThrow();
    // verifyCookie returns null when secret is missing (no key to verify with).
    expect(await verifyCookie("hello|123|abc")).toBeNull();
  });
});