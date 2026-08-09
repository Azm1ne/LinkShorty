import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signCookie, verifyCookie } from "./cookie";

const ORIGINAL_SECRET = process.env.COOKIE_SECRET;
const PASSWORD_VERSION = "v1";

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
    const raw = await signCookie("hello", expires, PASSWORD_VERSION);
    const decoded = await verifyCookie(raw, PASSWORD_VERSION);
    expect(decoded).toEqual({ slug: "hello", expiresAtMs: expires });
  });

  it("rejects an already-expired grant", async () => {
    const expires = Date.now() - 1000;
    const raw = await signCookie("hello", expires, PASSWORD_VERSION);
    // signCookie doesn't enforce a future date; verify does.
    expect(await verifyCookie(raw, PASSWORD_VERSION)).toBeNull();
  });

  it("rejects a tampered slug", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires, PASSWORD_VERSION);
    // Swap slug for something else, keep the original signature.
    const parts = raw.split("|");
    parts[0] = "goodbye";
    const tampered = parts.join("|");
    expect(await verifyCookie(tampered, PASSWORD_VERSION)).toBeNull();
  });

  it("rejects a tampered expiresAt", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires, PASSWORD_VERSION);
    // Bump the expiry so the original HMAC no longer matches.
    const parts = raw.split("|");
    parts[1] = String(Number(parts[1]) + 1_000_000);
    const tampered = parts.join("|");
    expect(await verifyCookie(tampered, PASSWORD_VERSION)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires, PASSWORD_VERSION);
    // Flip the last character of the signature.
    const last = raw[raw.length - 1];
    const flipped = last === "0" ? "1" : "0";
    const tampered = raw.slice(0, -1) + flipped;
    expect(await verifyCookie(tampered, PASSWORD_VERSION)).toBeNull();
  });

  it("rejects when signed with a different secret", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires, PASSWORD_VERSION);
    // Rotate the secret used for verification.
    process.env.COOKIE_SECRET = "totally-different-secret-32-bytes-x";
    expect(await verifyCookie(raw, PASSWORD_VERSION)).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await verifyCookie("", PASSWORD_VERSION)).toBeNull();
    expect(await verifyCookie("just-slug", PASSWORD_VERSION)).toBeNull();
    expect(await verifyCookie("slug|exp", PASSWORD_VERSION)).toBeNull();
    expect(
      await verifyCookie("slug|exp|version", PASSWORD_VERSION),
    ).toBeNull();
    expect(
      await verifyCookie("slug|not-a-number|version|sig", PASSWORD_VERSION),
    ).toBeNull();
    expect(await verifyCookie("|||sig", PASSWORD_VERSION)).toBeNull();
  });

  it("rejects a cookie signed with a different passwordVersion", async () => {
    const expires = Date.now() + 60_000;
    const raw = await signCookie("hello", expires, "old-hash");
    // Verify against a different password version (what happens after password change)
    expect(await verifyCookie(raw, "new-hash")).toBeNull();
    // Verify against the same version still works
    expect(await verifyCookie(raw, "old-hash")).not.toBeNull();
  });

  it("rejects malformed 4-part input", async () => {
    expect(await verifyCookie("", "v1")).toBeNull();
    expect(await verifyCookie("just-slug", "v1")).toBeNull();
    expect(await verifyCookie("slug|exp", "v1")).toBeNull();
    expect(await verifyCookie("slug|exp|version", "v1")).toBeNull();
    expect(await verifyCookie("slug|not-a-number|version|sig", "v1")).toBeNull();
    expect(await verifyCookie("|||sig", "v1")).toBeNull();
  });

  it("rejects when COOKIE_SECRET is unset", async () => {
    delete process.env.COOKIE_SECRET;
    const expires = Date.now() + 60_000;
    // signCookie throws when secret is missing.
    await expect(
      signCookie("hello", expires, PASSWORD_VERSION),
    ).rejects.toThrow();
    // verifyCookie returns null when secret is missing (no key to verify with).
    expect(await verifyCookie("hello|123|v1|abc", PASSWORD_VERSION)).toBeNull();
  });
});
