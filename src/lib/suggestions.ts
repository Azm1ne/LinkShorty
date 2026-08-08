/**
 * Slug suggestions when a slug is taken. Ordinal words read better than
 * digits for slugs meant to be spoken aloud or written on a whiteboard.
 *
 * Strategy:
 *   1. Try {slug}-one, {slug}-two, {slug}-three
 *   2. Try {slug}-2026
 *   3. Fall back to a random ordinal from a curated list
 *
 * `validateSuggestion` is the helper used by the check endpoint to filter
 * suggestions through the same slug rules before returning them — so a
 * suggestion is never something the user can't actually pick.
 */

import { ORDINALS } from "./wordlists";
import { validateSlug } from "./slug";

/** Generate up to `limit` suggestions. Skips invalid or reserved results. */
export function suggest(baseSlug: string, limit = 3): string[] {
  const candidates: string[] = [];

  // Tier 1: ordinal words (most readable)
  for (const ord of ["one", "two", "three"]) {
    candidates.push(`${baseSlug}-${ord}`);
  }

  // Tier 2: year
  candidates.push(`${baseSlug}-2026`);

  // Tier 3: more ordinals (random-looking without being truly random)
  for (const ord of ORDINALS) {
    if (candidates.length >= limit + 4) break;
    if (!candidates.includes(`${baseSlug}-${ord}`)) {
      candidates.push(`${baseSlug}-${ord}`);
    }
  }

  // Validate each candidate — drop ones that fail slug rules
  const valid: string[] = [];
  for (const candidate of candidates) {
    const result = validateSlug(candidate);
    if (result.ok && !valid.includes(result.slug)) {
      valid.push(result.slug);
    }
    if (valid.length >= limit) break;
  }
  return valid;
}

/** Filter a suggestion list through slug validation and dedup. */
export function validateSuggestions(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const result = validateSlug(candidate);
    if (result.ok && !seen.has(result.slug)) {
      seen.add(result.slug);
      out.push(result.slug);
    }
  }
  return out;
}