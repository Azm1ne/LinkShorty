/**
 * Tests for POST /api/admin/logout.
 *
 * The route's only job is to return a Set-Cookie header that clears the
 * `ls_admin` cookie in the browser. We verify:
 *   - 200 on a normal call
 *   - Set-Cookie is present with `ls_admin=`, `Max-Age=0`, matching
 *     attributes (httpOnly, sameSite=strict, path=/) so the browser
 *     actually targets the same cookie the login route set
 *   - 403 when the request is cross-origin (CSRF defense)
 *   - idempotent: works even with no cookie present
 */

import { describe, expect, it } from "vitest";
import { POST } from "./route";

function makeRequest(opts: { origin?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.origin) headers.origin = opts.origin;
  return new Request("http://localhost:3000/api/admin/logout", {
    method: "POST",
    headers,
  });
}

describe("POST /api/admin/logout", () => {
  it("returns 200 and clears the ls_admin cookie", async () => {
    const res = await POST(makeRequest({ origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.toLowerCase()).toMatch(/ls_admin=/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    expect(setCookie.toLowerCase()).toContain("path=/");
    // Max-Age=0 is the actual "delete this cookie" instruction.
    expect(setCookie).toMatch(/max-age=0/i);
  });

  it("is idempotent — works even when no admin cookie is present", async () => {
    const res = await POST(makeRequest({ origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.toLowerCase()).toContain("max-age=0");
  });

  it("returns 403 when the request is cross-origin", async () => {
    const res = await POST(makeRequest({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });
});
