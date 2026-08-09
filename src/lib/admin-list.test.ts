/**
 * Tests for the admin list helper. Covers pagination, prefix search,
 * lazy reconciliation (expired hashes get dropped), and pagination within
 * a prefix-search result set.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage-memory";
import {
  createLink,
  deleteLink,
  newEditToken,
} from "./links";
import { listLinks } from "./admin-list";

interface SeedOptions {
  slug: string;
  createdAt: number;
  expiresAt?: number;
  password?: string | null;
  url?: string;
}

async function seed(
  storage: MemoryStorage,
  opts: SeedOptions,
): Promise<void> {
  const { hash } = await newEditToken();
  await createLink(storage, {
    slug: opts.slug,
    url: opts.url ?? `https://example.com/${opts.slug}`,
    createdAt: opts.createdAt,
    expiresAt: opts.expiresAt ?? 0,
    password: opts.password ?? null,
    ipHash: "ip",
    editTokenHash: hash,
  });
}

describe("listLinks", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("returns links newest-first", async () => {
    await seed(storage, { slug: "older", createdAt: 1_000 });
    await seed(storage, { slug: "newer", createdAt: 2_000 });
    const result = await listLinks(storage);
    expect(result.links.map((l) => l.slug)).toEqual(["newer", "older"]);
    expect(result.total).toBe(2);
    expect(result.limit).toBe(50);
  });

  it("respects pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await seed(storage, { slug: `slug-${i}`, createdAt: i });
    }
    const page = await listLinks(storage, { offset: 1, limit: 2 });
    expect(page.links.map((l) => l.slug)).toEqual(["slug-3", "slug-2"]);
    expect(page.total).toBe(5);
  });

  it("clamps limit to max", async () => {
    await seed(storage, { slug: "a", createdAt: 1 });
    const result = await listLinks(storage, { limit: 10_000 });
    expect(result.limit).toBe(100);
  });

  it("filters by slug prefix using ZRANGEBYLEX", async () => {
    await seed(storage, { slug: "apple", createdAt: 3 });
    await seed(storage, { slug: "apricot", createdAt: 2 });
    await seed(storage, { slug: "banana", createdAt: 1 });
    const result = await listLinks(storage, { search: "ap" });
    expect(result.links.map((l) => l.slug).sort()).toEqual([
      "apple",
      "apricot",
    ]);
    expect(result.total).toBe(2);
  });

  it("prefix search orders results newest-first within the prefix", async () => {
    await seed(storage, { slug: "app-old", createdAt: 1 });
    await seed(storage, { slug: "app-new", createdAt: 5 });
    const result = await listLinks(storage, { search: "app" });
    expect(result.links.map((l) => l.slug)).toEqual(["app-new", "app-old"]);
  });

  it("prefix search applies offset and limit", async () => {
    for (let i = 0; i < 5; i++) {
      await seed(storage, { slug: `ap-${i}`, createdAt: i });
    }
    const page = await listLinks(storage, { search: "ap", offset: 1, limit: 2 });
    expect(page.links.map((l) => l.slug)).toEqual(["ap-3", "ap-2"]);
    expect(page.total).toBe(5);
  });

  it("drops expired hashes lazily and self-heals the index", async () => {
    const past = Date.now() - 60_000;
    await seed(storage, {
      slug: "expired",
      createdAt: past,
      expiresAt: past - 1,
    });
    await seed(storage, { slug: "live", createdAt: Date.now() });
    // Before any list call, the index still has the stale entry.
    expect(await storage.zcard("links:index")).toBe(2);

    const result = await listLinks(storage);
    // The expired link is filtered out of the page; the first list call also
    // ZREMs it from the index so subsequent calls don't rescan it.
    expect(result.links.map((l) => l.slug)).toEqual(["live"]);
    expect(await storage.zcard("links:index")).toBe(1);
  });

  it("subsequent list calls reflect the self-healed index", async () => {
    const past = Date.now() - 60_000;
    await seed(storage, {
      slug: "expired",
      createdAt: past,
      expiresAt: past - 1,
    });
    await seed(storage, { slug: "live", createdAt: Date.now() });

    // First call self-heals.
    await listLinks(storage);
    // Second call sees the cleaned-up total.
    const result = await listLinks(storage);
    expect(result.total).toBe(1);
    expect(result.links.map((l) => l.slug)).toEqual(["live"]);
  });

  it("returns empty list when index is empty", async () => {
    const result = await listLinks(storage);
    expect(result.links).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("reflects deletions via deleteLink", async () => {
    await seed(storage, { slug: "alpha", createdAt: 1 });
    await seed(storage, { slug: "beta", createdAt: 2 });
    const { hash } = await newEditToken();
    await deleteLink(storage, "alpha", hash);
    const result = await listLinks(storage);
    expect(result.links.map((l) => l.slug)).toEqual(["beta"]);
    expect(result.total).toBe(1);
  });
});
