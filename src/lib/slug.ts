import { RESERVED_SLUGS } from "./reserved-slugs";

/** Min slug length — 4 chars. Anything shorter is reserved for high-value targets. */
export const MIN_SLUG_LENGTH = 4;
/** Max slug length — 63 chars. */
export const MAX_SLUG_LENGTH = 63;
/**
 * Slug shape:
 *   ^[a-z0-9]([a-z0-9-]{2,61})[a-z0-9]$
 *
 * - First char: lowercase alphanumeric
 * - Middle 2..61 chars: alphanumeric or hyphen
 * - Last char: lowercase alphanumeric
 * - No leading/trailing hyphen, no consecutive hyphens (consecutive hyphens
 *   make a slug ambiguous when spoken aloud)
 */
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{2,61})[a-z0-9]$/;
const CONSECUTIVE_HYPHEN_REGEX = /--/;

export type SlugValidation =
  | { ok: true; slug: string }
  | {
      ok: false;
      reason: "too-short" | "invalid" | "reserved" | "consecutive-hyphens";
    };

/**
 * Normalize and validate a slug. Lowercases and trims before validation, so
 * "ML-Notes" becomes "ml-notes" rather than failing.
 */
export function validateSlug(input: string): SlugValidation {
  const slug = input.trim().toLowerCase();

  if (slug.length < MIN_SLUG_LENGTH) {
    return { ok: false, reason: "too-short" };
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    return { ok: false, reason: "invalid" };
  }
  if (CONSECUTIVE_HYPHEN_REGEX.test(slug)) {
    return { ok: false, reason: "consecutive-hyphens" };
  }
  if (!SLUG_REGEX.test(slug)) {
    return { ok: false, reason: "invalid" };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, slug };
}