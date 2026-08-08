/**
 * Auto-generate a slug from the curated wordlists. Three words joined by
 * hyphens: `adjective-noun-adjective`. Two adjectives, one noun reads more
 * balanced than noun-adjective-noun and is harder to mispronounce.
 *
 * Random enough (~8M combos) that collisions are rare; deterministic enough
 * to be reproducible in tests when given a fixed entropy source.
 */

import { ADJECTIVES, NOUNS } from "./wordlists";

export interface AutoSlugOptions {
  /** Entropy source. Defaults to Math.random for production. Tests pass a seed. */
  rand?: () => number;
}

export function generateAutoSlug(opts: AutoSlugOptions = {}): string {
  const rand = opts.rand ?? Math.random;
  const adj1 = pick(ADJECTIVES, rand);
  const noun = pick(NOUNS, rand);
  const adj2 = pick(ADJECTIVES, rand);
  return `${adj1}-${noun}-${adj2}`;
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  // Guard against empty arrays — defensive, never expected.
  if (arr.length === 0) {
    throw new Error("wordlist is empty");
  }
  const idx = Math.floor(rand() * arr.length);
  return arr[Math.min(idx, arr.length - 1)];
}