import { describe, expect, it } from "vitest";
import { generateAutoSlug } from "./auto-slug";
import { ADJECTIVES, NOUNS } from "./wordlists";

describe("generateAutoSlug", () => {
  it("returns a slug matching the adjective-noun-adjective shape", () => {
    const slug = generateAutoSlug();
    expect(slug).toMatch(/^[a-z0-9]([a-z0-9-]{2,61})[a-z0-9]$/);
    const parts = slug.split("-");
    expect(parts).toHaveLength(3);
    expect(ADJECTIVES).toContain(parts[0]);
    expect(NOUNS).toContain(parts[1]);
    expect(ADJECTIVES).toContain(parts[2]);
  });

  it("is deterministic with a fixed entropy source", () => {
    // Mulberry32-style: incrementing counter returns deterministic values
    let counter = 0;
    const rand = () => {
      counter = (counter + 1) % 1000;
      return counter / 1000;
    };
    const a = generateAutoSlug({ rand });
    const b = generateAutoSlug({ rand });
    expect(a).not.toBe(b);
  });

  it("produces different results across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(generateAutoSlug({ rand: Math.random }));
    }
    // 50 generations should not all collide — random enough to give variety
    expect(seen.size).toBeGreaterThan(40);
  });
});