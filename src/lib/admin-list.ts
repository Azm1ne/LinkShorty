/**
 * Admin-only listing of links. Shared between the `/api/admin/links` route
 * and the `/admin` server page so both views see the same shape.
 *
 * Newest-first by default via `ZREVRANGE` on `links:index`. When a prefix
 * search is requested, we use `ZRANGEBYLEX` with `[prefix, prefix\xff)` to
 * fetch every slug that starts with the prefix, then paginate in memory
 * (the index is small — this is a personal shortener).
 *
 * Lazy reconciliation: hashes that have expired but haven't been swept yet
 * come back as `null` from `ZREVRANGE` -> `MGET`. We drop those.
 */

import type { Storage } from "./storage";
import type { LinkRecord } from "./links";

const LINKS_INDEX = "links:index";
const LINK_KEY_PREFIX = "link:";
const linkKey = (slug: string) => `${LINK_KEY_PREFIX}${slug}`;

export interface ListLinksOptions {
  offset?: number;
  limit?: number;
  /** Slug prefix. If non-empty, results are filtered to slugs starting with this. */
  search?: string;
}

export interface ListLinksResult {
  links: LinkRecord[];
  total: number;
  offset: number;
  limit: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Build a `LinkRecord` from a hash. Returns null if the hash is missing or
 * expired (we already filter nils from MGET, but this also enforces the
 * lazy expiry check used by `readLink`).
 */
function recordFromHash(slug: string, hash: Record<string, string> | null): LinkRecord | null {
  if (!hash) return null;
  const url = hash.url;
  const createdAt = Number(hash.createdAt);
  if (!url || !createdAt) return null;
  const expiresAt = Number(hash.expiresAt) || 0;
  if (expiresAt > 0 && Date.now() >= expiresAt) return null;
  return {
    slug,
    url,
    createdAt,
    expiresAt,
    hasPassword: !!hash.passwordHash,
    previousUrl: hash.previousUrl || null,
  };
}

/**
 * Hydrate a list of slugs into LinkRecords, dropping any that have expired
 * or vanished. Used both for paginated ZREVRANGE results and for ZRANGEBYLEX
 * search results.
 *
 * Self-healing: when an index entry points at a hash that's gone (TTL swept
 * it, or it was deleted from a different code path that didn't update the
 * index), we ZREM the stale entry so we don't rescan it every list. Lazy
 * reconciliation should converge the index on the next read.
 */
async function hydrateSlugs(
  storage: Storage,
  slugs: string[],
): Promise<LinkRecord[]> {
  if (slugs.length === 0) return [];
  const out: LinkRecord[] = [];
  for (const slug of slugs) {
    const hash = await storage.hgetall(linkKey(slug));
    if (!hash) {
      // Hash is gone (expired via TTL) but the index entry survived it.
      // Self-heal so we don't rescan it every list.
      await storage.zrem(LINKS_INDEX, slug);
      continue;
    }
    const rec = recordFromHash(slug, hash);
    if (!rec) {
      // Hash exists but recordFromHash rejected it (lazy expiry).
      // Same self-heal.
      await storage.zrem(LINKS_INDEX, slug);
      continue;
    }
    out.push(rec);
  }
  return out;
}

/**
 * Re-order a list of slugs newest-first by their `links:index` score. Used
 * for prefix-search results, where `ZRANGEBYLEX` returns members in lex
 * order rather than by creation time.
 *
 * Implementation: scan the whole index in newest-first order and pick out
 * only the slugs in the input set. Fine for a personal shortener — at scale
 * a dedicated reverse index would be needed.
 */
async function orderByCreatedAtDesc(
  storage: Storage,
  slugs: string[],
): Promise<string[]> {
  if (slugs.length === 0) return [];
  const wanted = new Set(slugs);
  const allNewestFirst = await storage.zrevrange(LINKS_INDEX, 0, -1);
  return allNewestFirst.filter((e) => wanted.has(e.member)).map((e) => e.member);
}

/**
 * List links newest-first, with optional pagination and a slug-prefix search.
 *
 * Search vs. pagination: the index's `ZREVRANGE` ordering is by `createdAt`,
 * but `ZRANGEBYLEX` returns lexicographic order. We resolve prefix search
 * first (lex), then slice for the page; the visible ordering is reverse
 * createdAt within the prefix. For a small index this is fine — we'd
 * revisit if the list grows to thousands.
 */
export async function listLinks(
  storage: Storage,
  options: ListLinksOptions = {},
): Promise<ListLinksResult> {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, options.limit ?? DEFAULT_LIMIT),
  );
  const search = (options.search ?? "").trim();

  const total = await storage.zcard(LINKS_INDEX);

  if (search) {
    // For prefix search, we use lex bounds. `[prefix, prefix\xff)` is the
    // canonical Redis idiom for "everything starting with prefix".
    const min = `[${search}`;
    const max = `[${search}\xff`;
    const matchingSlugs = await storage.zrangebylex(LINKS_INDEX, min, max);
    // ZRANGEBYLEX returns members in lex order, not by createdAt. Re-sort
    // by createdAt descending using the index so the page is newest-first
    // within the prefix, matching the non-search path.
    const ordered = await orderByCreatedAtDesc(storage, matchingSlugs);
    const page = ordered.slice(offset, offset + limit);
    const records = await hydrateSlugs(storage, page);
    return { links: records, total: matchingSlugs.length, offset, limit };
  }

  const entries = await storage.zrevrange(LINKS_INDEX, offset, offset + limit - 1);
  const slugs = entries.map((e) => e.member);
  const records = await hydrateSlugs(storage, slugs);
  return { links: records, total, offset, limit };
}
