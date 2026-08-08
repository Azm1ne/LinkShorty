/**
 * Link data model and CRUD over storage.
 *
 * Stored as a Redis hash at `link:{slug}` with these fields:
 *   - url            string  destination, validated http(s)
 *   - createdAt      number  unix ms
 *   - expiresAt      number  unix ms, or 0 for permanent
 *   - editTokenHash  string  SHA-256 of the secret edit token
 *   - passwordHash   string  SHA-256 of the password, or "" if none
 *   - createdByIp    string  SHA-256(ip + IP_SALT)
 *   - previousUrl    string  last repointed destination, or "" if never
 *
 * Index for the admin list: `links:index` sorted set, slug → createdAt ms.
 */

import type { Storage } from "./storage";
import { generateToken, hashEditToken, hashIp, hashPassword } from "./hash";

const LINKS_INDEX = "links:index";

const linkKey = (slug: string) => `link:${slug}`;

export interface LinkRecord {
  slug: string;
  url: string;
  createdAt: number;
  expiresAt: number; // 0 = permanent
  hasPassword: boolean;
  previousUrl: string | null;
}

export interface CreateLinkInput {
  slug: string;
  url: string;
  createdAt: number;
  expiresAt: number;
  password: string | null;
  ipHash: string;
}

/** Generate a 32-byte token, return both the raw token and its hash. */
export async function newEditToken(): Promise<{ token: string; hash: string }> {
  const token = generateToken();
  const hash = await hashEditToken(token);
  return { token, hash };
}

/**
 * Persist a new link. Sets native TTL when expiresAt > 0. Adds to the index.
 *
 * Caller is responsible for slug validation (this function trusts the slug).
 */
export async function createLink(
  storage: Storage,
  input: CreateLinkInput & { editTokenHash: string },
): Promise<void> {
  const { slug, url, expiresAt, password, ipHash, editTokenHash, createdAt } = input;
  const passwordHash = password ? await hashPassword(password, slug) : "";

  await storage.hset(linkKey(slug), "url", url);
  await storage.hset(linkKey(slug), "createdAt", String(createdAt));
  await storage.hset(linkKey(slug), "expiresAt", String(expiresAt));
  await storage.hset(linkKey(slug), "editTokenHash", editTokenHash);
  await storage.hset(linkKey(slug), "passwordHash", passwordHash);
  await storage.hset(linkKey(slug), "createdByIp", ipHash);
  await storage.hset(linkKey(slug), "previousUrl", "");

  if (expiresAt > 0) {
    await storage.expireAt(linkKey(slug), Math.floor(expiresAt / 1000));
  }

  await storage.zadd(LINKS_INDEX, createdAt, slug);
}

/** Read a link from storage. Returns null if missing or expired. */
export async function readLink(
  storage: Storage,
  slug: string,
): Promise<LinkRecord | null> {
  const data = await storage.hgetall(linkKey(slug));
  if (!data) return null;

  const url = data.url;
  const createdAt = Number(data.createdAt);
  const expiresAt = Number(data.expiresAt);
  if (!url || !createdAt) return null;

  // Lazy expiry check — Redis may not have swept the key yet
  if (expiresAt > 0 && Date.now() >= expiresAt) return null;

  return {
    slug,
    url,
    createdAt,
    expiresAt,
    hasPassword: !!data.passwordHash,
    previousUrl: data.previousUrl || null,
  };
}

/**
 * Read a link's stored edit token hash. Used by /edit/[token] to verify the
 * caller has the token. Returns null if the link doesn't exist.
 */
export async function readEditTokenHash(
  storage: Storage,
  slug: string,
): Promise<string | null> {
  const data = await storage.hgetall(linkKey(slug));
  return data?.editTokenHash ?? null;
}

/** Read the stored password hash (or "" if no password). */
export async function readPasswordHash(
  storage: Storage,
  slug: string,
): Promise<string | null> {
  const data = await storage.hgetall(linkKey(slug));
  if (!data) return null;
  return data.passwordHash ?? "";
}

/** Check whether a slug exists and is not expired. */
export async function slugExists(
  storage: Storage,
  slug: string,
): Promise<boolean> {
  const link = await readLink(storage, slug);
  return link !== null;
}

/**
 * Update an existing link. Caller is responsible for verifying the edit
 * token. Updates url, expiresAt, and passwordHash; updates previousUrl when
 * the destination changes.
 */
export async function updateLink(
  storage: Storage,
  slug: string,
  patch: {
    url?: string;
    expiresAt?: number;
    password?: string | null; // null to clear, undefined to leave, string to set
  },
): Promise<void> {
  const existing = await storage.hgetall(linkKey(slug));
  if (!existing) {
    throw new Error("link not found");
  }

  if (patch.url !== undefined && patch.url !== existing.url) {
    await storage.hset(linkKey(slug), "previousUrl", existing.url ?? "");
    await storage.hset(linkKey(slug), "url", patch.url);
  }
  if (patch.expiresAt !== undefined) {
    await storage.hset(linkKey(slug), "expiresAt", String(patch.expiresAt));
    if (patch.expiresAt > 0) {
      await storage.expireAt(linkKey(slug), Math.floor(patch.expiresAt / 1000));
    } else {
      // Going permanent — Redis would otherwise keep the old EXPIREAT,
      // so the hash gets evicted early and `readLink` returns null. PERSIST
      // drops the TTL but leaves the key intact.
      await storage.clearExpiry(linkKey(slug));
    }
  }
  if (patch.password !== undefined) {
    const passwordHash = patch.password
      ? await hashPassword(patch.password, slug)
      : "";
    await storage.hset(linkKey(slug), "passwordHash", passwordHash);
  }
}

/** Delete a link entirely. */
export async function deleteLink(
  storage: Storage,
  slug: string,
): Promise<void> {
  await storage.del(linkKey(slug));
  await storage.zrem(LINKS_INDEX, slug);
}

/**
 * Find the slug whose `editTokenHash` matches SHA-256(token). Scans the
 * links:index — fine for a personal shortener. For higher scale, a reverse
 * lookup index would be needed.
 *
 * Returns the slug, or null if no link matches.
 */
export async function findSlugByToken(
  storage: Storage,
  token: string,
): Promise<string | null> {
  const hash = await hashEditToken(token);
  const entries = await storage.zrevrange(LINKS_INDEX, 0, -1);
  for (const entry of entries) {
    const data = await storage.hgetall(linkKey(entry.member));
    if (data?.editTokenHash === hash) {
      return entry.member;
    }
  }
  return null;
}