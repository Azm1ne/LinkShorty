/**
 * Tests for POST /api/admin/login. Mirrors the gate route test pattern:
 *   - 400 on malformed body
 *   - 401 on wrong password
 *   - 200 + Set-Cookie on correct password
 *   - 429 after 5 attempts in the window
 *
 * Uses the singleton's `__setStorage` helper to inject an in-memory store.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { __resetStorage, __setStorage } from "@/lib/storage-singleton";
import { MemoryStorage } from "@/lib/storage-memory";

const ORIGINAL_SECRET = process.env.COOKIE_SECRET;
const ORIGINAL_PASSWORD = process.env.ADMIN_PASSWORD;

function makeRequest(body: unknown, ip = "203.0.113.7") {
  return new Request("http://localhost/api/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-client-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/login", () => {
  beforeEach(() => {
    process.env.COOKIE_SECRET = "test-secret-32-bytes-long-please";
    process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
    __setStorage(new MemoryStorage());
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.COOKIE_SECRET;
    else process.env.COOKIE_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_PASSWORD === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = ORIGINAL_PASSWORD;
    __resetStorage();
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 401 on a wrong password", async () => {
    const res = await POST(makeRequest({ password: "wrong" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid-password");
  });

  it("returns 200 and sets the ls_admin cookie on correct password", async () => {
    const res = await POST(makeRequest({ password: "correct-horse-battery-staple" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.toLowerCase()).toMatch(/ls_admin=/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    expect(setCookie.toLowerCase()).toContain("path=/");
    // 7-day lifetime = 604800 seconds
    expect(setCookie).toMatch(/max-age=604800/i);
  });

  it("429s after 5 wrong attempts within 15 min", async () => {
    // First 5 attempts are 401 (the 6th would 429).
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ password: "wrong" }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(makeRequest({ password: "wrong" }));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe("rate-limited");
    expect(body.type).toBe("admin-login");
    expect(typeof body.retryAfterSeconds).toBe("number");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("returns 500 when ADMIN_PASSWORD env is not set", async () => {
    delete process.env.ADMIN_PASSWORD;
    const res = await POST(makeRequest({ password: "anything" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("admin-not-configured");
  });
});
