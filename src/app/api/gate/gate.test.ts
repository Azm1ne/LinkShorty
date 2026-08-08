import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearStorageForTests,
  setStorageForTests,
} from "@/lib/storage-singleton";
import { MemoryStorage } from "@/lib/storage-memory";
import { createLink, newEditToken } from "@/lib/links";
import { hashPassword } from "@/lib/hash";
import { POST } from "./[slug]/route";

// Pull the runtime helpers in via dynamic import so the global storage swap
// doesn't interfere with module init.

const ORIGINAL_SECRET = process.env.COOKIE_SECRET;

function makeRequest(body: unknown, slug: string, ip = "203.0.113.1") {
  return new Request(`http://localhost/api/gate/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-client-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

async function seedProtectedLink(storage: MemoryStorage, slug: string, password: string) {
  const { hash } = await newEditToken();
  await createLink(storage, {
    slug,
    url: "https://example.com/secret",
    createdAt: 1_700_000_000_000,
    expiresAt: 0,
    password,
    ipHash: "ip",
    editTokenHash: hash,
  });
}

describe("POST /api/gate/[slug]", () => {
  beforeEach(() => {
    process.env.COOKIE_SECRET = "test-secret-32-bytes-long-please";
    setStorageForTests(new MemoryStorage());
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.COOKIE_SECRET;
    } else {
      process.env.COOKIE_SECRET = ORIGINAL_SECRET;
    }
    clearStorageForTests();
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(
      makeRequest({}, "secret"),
      { params: Promise.resolve({ slug: "secret" }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await POST(
      makeRequest({ password: "hunter2" }, "missing"),
      { params: Promise.resolve({ slug: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 for a wrong password", async () => {
    const storage = new MemoryStorage();
    setStorageForTests(storage);
    await seedProtectedLink(storage, "secret", "correct");

    const res = await POST(
      makeRequest({ password: "wrong" }, "secret"),
      { params: Promise.resolve({ slug: "secret" }) },
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid-password");
  });

  it("returns 200 and sets the cookie for a correct password", async () => {
    const storage = new MemoryStorage();
    setStorageForTests(storage);
    await seedProtectedLink(storage, "secret", "correct");

    const res = await POST(
      makeRequest({ password: "correct" }, "secret"),
      { params: Promise.resolve({ slug: "secret" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.destination).toBe("https://example.com/secret");
    expect(body.slug).toBe("secret");

    // Set-Cookie should be present and look like a signed gate cookie.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/ls_gate=/);
    // Cookie must be HttpOnly.
    expect(setCookie.toLowerCase()).toContain("httponly");
    // Cookie path is "/"
    expect(setCookie).toMatch(/path=\//i);
  });

  it("429s after 10 wrong attempts within an hour", async () => {
    const storage = new MemoryStorage();
    setStorageForTests(storage);
    await seedProtectedLink(storage, "secret", "correct");

    // First 10 attempts are 401 (the 11th would 429).
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        makeRequest({ password: "wrong" }, "secret"),
        { params: Promise.resolve({ slug: "secret" }) },
      );
      expect(res.status).toBe(401);
    }
    // 11th attempt is rate-limited — even with the correct password.
    const blocked = await POST(
      makeRequest({ password: "correct" }, "secret"),
      { params: Promise.resolve({ slug: "secret" }) },
    );
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe("rate-limited");
    expect(typeof body.retryAfterSeconds).toBe("number");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("rate-limits are scoped per slug (a wrong attempt on slug A doesn't block slug B)", async () => {
    const storage = new MemoryStorage();
    setStorageForTests(storage);
    await seedProtectedLink(storage, "slug-a", "correct");
    await seedProtectedLink(storage, "slug-b", "correct");

    // 10 wrong attempts on slug-a
    for (let i = 0; i < 10; i++) {
      await POST(
        makeRequest({ password: "wrong" }, "slug-a"),
        { params: Promise.resolve({ slug: "slug-a" }) },
      );
    }
    // slug-a is now blocked
    const blocked = await POST(
      makeRequest({ password: "correct" }, "slug-a"),
      { params: Promise.resolve({ slug: "slug-a" }) },
    );
    expect(blocked.status).toBe(429);

    // slug-b still works
    const ok = await POST(
      makeRequest({ password: "correct" }, "slug-b"),
      { params: Promise.resolve({ slug: "slug-b" }) },
    );
    expect(ok.status).toBe(200);
  });

  it("uses hashPassword which produces an Argon2id PHC string", async () => {
    // Sanity check on the hash scheme used in this route.
    const a = await hashPassword("hunter2", "slug-a");
    const b = await hashPassword("hunter2", "slug-b");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\$argon2id\$v=19\$/);
  });
});