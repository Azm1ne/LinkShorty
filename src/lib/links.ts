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
import { generateToken, hashEditToken, hashPassword } from "./hash";

const LINKS_INDEX = "links:index";
const TOKENS_INDEX = "tokens:index";

const linkKey = (slug: string) => `link:${slug}`;
const tokenIndexKey = (tokenHash: string) => `${TOKENS_INDEX}:${tokenHash}`;

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
 * Persist a new link. Sets native TTL when expiresAt > 0. Adds to the index
 * and the tokens:index reverse-lookup — all in a single transaction so a
 * partial failure can't leave the link visible but not in the index (or
 * vice versa).
 *
 * Caller is responsible for slug validation (this function trusts the slug).
 */
export async function createLink(
  storage: Storage,
  input: CreateLinkInput & { editTokenHash: string },
): Promise<void> {
  const { slug, url, expiresAt, password, ipHash, editTokenHash, createdAt } = input;
  const passwordHash = password ? await hashPassword(password, slug) : "";

  await storage.createLinkTransaction(
    linkKey(slug),
    {
      url,
      createdAt: String(createdAt),
      expiresAt: String(expiresAt),
      editTokenHash,
      passwordHash,
      createdByIp: ipHash,
      previousUrl: "",
    },
    expiresAt > 0 ? Math.floor(expiresAt / 1000) : null,
    LINKS_INDEX,
    createdAt,
    slug,
    tokenIndexKey(editTokenHash),
    slug,
  );
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
 * the destination changes. All writes happen in a single transaction so a
 * partial failure can't leave (e.g.) previousUrl pointing at the same URL.
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

  const fields: Record<string, string> = {};
  if (patch.url !== undefined && patch.url !== existing.url) {
    fields.previousUrl = existing.url ?? "";
    fields.url = patch.url;
  }
  if (patch.expiresAt !== undefined) {
    fields.expiresAt = String(patch.expiresAt);
  }
  if (patch.password !== undefined) {
    fields.passwordHash = patch.password
      ? await hashPassword(patch.password, slug)
      : "";
  }

  let expiry:
    | { type: "set"; unixSeconds: number }
    | { type: "clear" }
    | null = null;
  if (patch.expiresAt !== undefined) {
    expiry =
      patch.expiresAt > 0
        ? { type: "set", unixSeconds: Math.floor(patch.expiresAt / 1000) }
        : { type: "clear" };
  }

  await storage.updateLinkTransaction(linkKey(slug), fields, expiry);
}

/**
 * Delete a link entirely. Caller passes the `editTokenHash` so we don't need
 * an extra HGETALL just to clean up the tokens:index reverse-lookup entry.
 * All three deletes (hash, index, reverse-lookup) run in a single
 * transaction so a partial failure can't leave an orphaned index entry.
 */
export async function deleteLink(
  storage: Storage,
  slug: string,
  editTokenHash: string,
): Promise<void> {
  await storage.deleteLinkTransaction(
    linkKey(slug),
    LINKS_INDEX,
    slug,
    tokenIndexKey(editTokenHash),
  );
}

/**
 * Find the slug whose `editTokenHash` matches SHA-256(token). O(1) via the
 * `tokens:index` reverse-lookup hash — the create/delete paths keep it in
 * sync with `link:{slug}.editTokenHash`.
 *
 * Returns the slug, or null if no link matches.
 */
export async function findSlugByToken(
  storage: Storage,
  token: string,
): Promise<string | null> {
  const hash = await hashEditToken(token);
  return storage.get(tokenIndexKey(hash));
}