import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage-memory";
import {
  createLink,
  deleteLink,
  newEditToken,
  readLink,
  slugExists,
  updateLink,
} from "./links";

async function seedLink(storage: MemoryStorage) {
  const { token, hash } = await newEditToken();
  await createLink(storage, {
    slug: "ml-notes",
    url: "https://example.com/ml",
    createdAt: 1_700_000_000_000,
    expiresAt: 0,
    password: null,
    ipHash: "ip-hash",
    editTokenHash: hash,
  });
  return { token, hash };
}

describe("link CRUD", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("creates a link and reads it back", async () => {
    await seedLink(storage);
    const link = await readLink(storage, "ml-notes");
    expect(link).toMatchObject({
      slug: "ml-notes",
      url: "https://example.com/ml",
      expiresAt: 0,
      hasPassword: false,
      previousUrl: null,
    });
  });

  it("creates an expiring link with TTL set on the key", async () => {
    // Use a fixed clock so the TTL value is deterministic regardless of when
    // the test runs. MemoryStorage accepts a clock function in its constructor.
    const baseTime = 2_000_000_000_000;
    const ctrl = new MemoryStorage(() => baseTime);
    const { hash } = await newEditToken();
    const expiresAt = baseTime + 60_000;
    await createLink(ctrl, {
      slug: "short",
      url: "https://example.com",
      createdAt: baseTime,
      expiresAt,
      password: null,
      ipHash: "ip",
      editTokenHash: hash,
    });
    // TTL should be 60 seconds — relative to the controlled clock
    const ttl = await ctrl.ttl("link:short");
    expect(ttl).toBe(60);
  });

  it("readLink returns null when key is missing", async () => {
    expect(await readLink(storage, "missing")).toBeNull();
  });

  it("readLink returns null when expiresAt is in the past", async () => {
    const { hash } = await newEditToken();
    // Use a past timestamp relative to Date.now() — the lazy expiry check
    // compares the stored expiresAt against the real clock.
    const past = Date.now() - 60_000;
    await createLink(storage, {
      slug: "expiring",
      url: "https://example.com",
      createdAt: past,
      expiresAt: past - 1,
      password: null,
      ipHash: "ip",
      editTokenHash: hash,
    });
    expect(await readLink(storage, "expiring")).toBeNull();
  });

  it("slugExists returns true when present, false when missing", async () => {
    await seedLink(storage);
    expect(await slugExists(storage, "ml-notes")).toBe(true);
    expect(await slugExists(storage, "other")).toBe(false);
  });

  it("creates a link with a password hash", async () => {
    const { hash } = await newEditToken();
    await createLink(storage, {
      slug: "secret",
      url: "https://example.com",
      createdAt: 1,
      expiresAt: 0,
      password: "hunter2",
      ipHash: "ip",
      editTokenHash: hash,
    });
    const link = await readLink(storage, "secret");
    expect(link?.hasPassword).toBe(true);
  });

  it("updateLink changes the URL and tracks previousUrl", async () => {
    await seedLink(storage);
    await updateLink(storage, "ml-notes", { url: "https://example.com/v2" });
    const link = await readLink(storage, "ml-notes");
    expect(link?.url).toBe("https://example.com/v2");
    expect(link?.previousUrl).toBe("https://example.com/ml");
  });

  it("updateLink does not track previousUrl when url is unchanged", async () => {
    await seedLink(storage);
    await updateLink(storage, "ml-notes", { url: "https://example.com/ml" });
    const link = await readLink(storage, "ml-notes");
    expect(link?.previousUrl).toBeNull();
  });

  it("updateLink changes the password", async () => {
    await seedLink(storage);
    await updateLink(storage, "ml-notes", { password: "new-pw" });
    const link = await readLink(storage, "ml-notes");
    expect(link?.hasPassword).toBe(true);
  });

  it("updateLink removes the password when passed null", async () => {
    const { hash } = await newEditToken();
    await createLink(storage, {
      slug: "secret",
      url: "https://example.com",
      createdAt: 1,
      expiresAt: 0,
      password: "old-pw",
      ipHash: "ip",
      editTokenHash: hash,
    });
    await updateLink(storage, "secret", { password: null });
    const link = await readLink(storage, "secret");
    expect(link?.hasPassword).toBe(false);
  });

  it("updateLink throws when link doesn't exist", async () => {
    await expect(
      updateLink(storage, "missing", { url: "https://x.com" }),
    ).rejects.toThrow();
  });

  it("deleteLink removes the hash and the index entry", async () => {
    await seedLink(storage);
    expect(await slugExists(storage, "ml-notes")).toBe(true);
    await deleteLink(storage, "ml-notes");
    expect(await slugExists(storage, "ml-notes")).toBe(false);
    // Index member also gone
    const remaining = await storage.zrevrange("links:index", 0, -1);
    expect(remaining).toEqual([]);
  });
});