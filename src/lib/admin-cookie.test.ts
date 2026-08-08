/**
 * Tests for the admin namespace of the cookie helper.
 *
 * The shell cookie helpers (the password gate's `signCookie`/`verifyCookie`)
 * are exercised by the gate's own tests. Here we focus on the admin path:
 *   - signAdminCookie produces a value that verifies
 *   - verifyAdminCookie rejects bad namespaces, bad signatures, expired
 *   - the integration with `ADMIN_COOKIE_OPTIONS` is consistent
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_OPTIONS,
  signAdminCookie,
  verifyAdminCookie,
} from "./cookie";

describe("admin cookie helpers", () => {
  beforeAll(() => {
    process.env.COOKIE_SECRET = "test-secret-32-bytes-long-for-hmac-sha256";
  });

  afterEach(() => {
    // No global state to clean; tests are pure.
  });

  it("signs and verifies a fresh admin cookie", async () => {
    const value = await signAdminCookie();
    const grant = await verifyAdminCookie(value);
    expect(grant).not.toBeNull();
    expect(grant!.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("rejects a cookie with a tampered signature", async () => {
    const value = await signAdminCookie();
    // Flip the last hex char of the signature.
    const last = value.slice(-1);
    const flipped = last === "0" ? "1" : "0";
    const tampered = value.slice(0, -1) + flipped;
    expect(await verifyAdminCookie(tampered)).toBeNull();
  });

  it("rejects a cookie with a wrong namespace", async () => {
    const value = await signAdminCookie();
    // Replace the namespace segment.
    const parts = value.split("|");
    parts[0] = "evil";
    const forged = parts.join("|");
    expect(await verifyAdminCookie(forged)).toBeNull();
  });

  it("rejects a cookie with the wrong number of segments", async () => {
    expect(await verifyAdminCookie("not-a-cookie")).toBeNull();
    expect(await verifyAdminCookie("a|b|c")).toBeNull();
  });

  it("rejects empty or null input", async () => {
    expect(await verifyAdminCookie(undefined)).toBeNull();
    expect(await verifyAdminCookie(null)).toBeNull();
    expect(await verifyAdminCookie("")).toBeNull();
  });

  it("rejects an expired cookie", async () => {
    // Build a manually-signed cookie that expires in the past.
    const secret = process.env.COOKIE_SECRET!;
    const enc = new TextEncoder();
    const expiresAtMs = Date.now() - 1_000;
    const message = `admin|${expiresAtMs}|1`;
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    const sigHex = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const raw = `${message}|${sigHex}`;
    expect(await verifyAdminCookie(raw)).toBeNull();
  });

  it("uses the ls_admin cookie name and 7-day lifetime", () => {
    expect(ADMIN_COOKIE_NAME).toBe("ls_admin");
    const sevenDays = 7 * 24 * 60 * 60;
    expect(ADMIN_COOKIE_OPTIONS.maxAgeSeconds).toBe(sevenDays);
    expect(ADMIN_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(ADMIN_COOKIE_OPTIONS.sameSite).toBe("strict");
    expect(ADMIN_COOKIE_OPTIONS.path).toBe("/");
  });
});
