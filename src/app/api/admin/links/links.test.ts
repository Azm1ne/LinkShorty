/**
 * Tests for GET /api/admin/links and DELETE /api/admin/links.
 *
 * Confirms the cookie gate, basic list shape, prefix search, and the
 * delete round-trip.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, DELETE } from "./route";
import { __resetStorage, __setStorage } from "@/lib/storage-singleton";
import { MemoryStorage } from "@/lib/storage-memory";
import { createLink, newEditToken } from "@/lib/links";
import { signAdminCookie } from "@/lib/cookie";

const ORIGINAL_SECRET = process.env.COOKIE_SECRET;

async function seed(
  storage: MemoryStorage,
  slug: string,
  createdAt: number,
): Promise<void> {
  const { hash } = await newEditToken();
  await createLink(storage, {
    slug,
    url: `https://example.com/${slug}`,
    createdAt,
    expiresAt: 0,
    password: null,
    ipHash: "ip",
    editTokenHash: hash,
  });
}

function makeGetRequest(cookie: string | null, searchParams = ""): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `ls_admin=${cookie}`;
  return new Request(`http://localhost/api/admin/links${searchParams}`, {
    method: "GET",
    headers,
  });
}

function makeDeleteRequest(cookie: string | null, slug: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = `ls_admin=${cookie}`;
  return new Request("http://localhost/api/admin/links", {
    method: "DELETE",
    headers,
    body: JSON.stringify({ slug }),
  });
}

describe("admin /api/admin/links", () => {
  beforeEach(() => {
    process.env.COOKIE_SECRET = "test-secret-32-bytes-long-please";
    __setStorage(new MemoryStorage());
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.COOKIE_SECRET;
    else process.env.COOKIE_SECRET = ORIGINAL_SECRET;
    __resetStorage();
  });

  it("returns 401 without a cookie", async () => {
    const res = await GET(makeGetRequest(null));
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid cookie", async () => {
    const res = await GET(makeGetRequest("not-a-real-cookie"));
    expect(res.status).toBe(401);
  });

  it("returns the latest links with a valid cookie", async () => {
    const storage = new MemoryStorage();
    __setStorage(storage);
    await seed(storage, "alpha", 1);
    await seed(storage, "beta", 2);
    await seed(storage, "gamma", 3);

    const cookie = await signAdminCookie();
    const res = await GET(makeGetRequest(cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.links.map((l: { slug: string }) => l.slug)).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
    expect(body.total).toBe(3);
  });

  it("supports prefix search via the search query param", async () => {
    const storage = new MemoryStorage();
    __setStorage(storage);
    await seed(storage, "apple", 1);
    await seed(storage, "apricot", 2);
    await seed(storage, "banana", 3);

    const cookie = await signAdminCookie();
    const res = await GET(makeGetRequest(cookie, "?search=ap"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.links.map((l: { slug: string }) => l.slug).sort()).toEqual([
      "apple",
      "apricot",
    ]);
    expect(body.total).toBe(2);
  });

  it("deletes a link and reports success", async () => {
    const storage = new MemoryStorage();
    __setStorage(storage);
    await seed(storage, "doomed", 1);
    await seed(storage, "keeper", 2);

    const cookie = await signAdminCookie();
    const res = await DELETE(makeDeleteRequest(cookie, "doomed"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ slug: "doomed", deleted: true });

    // Verify removal.
    const list = await GET(makeGetRequest(cookie));
    const listBody = await list.json();
    expect(listBody.links.map((l: { slug: string }) => l.slug)).toEqual([
      "keeper",
    ]);
  });

  it("rejects DELETE without a cookie", async () => {
    const res = await DELETE(makeDeleteRequest(null, "anything"));
    expect(res.status).toBe(401);
  });

  it("rejects DELETE with an invalid slug", async () => {
    const cookie = await signAdminCookie();
    const res = await DELETE(makeDeleteRequest(cookie, "BAD!SLUG"));
    expect(res.status).toBe(400);
  });
});