import { describe, expect, it } from "vitest";
import { suggest, validateSuggestions } from "./suggestions";

describe("suggest", () => {
  it("returns suggestions in tier order: one, two, three", () => {
    const out = suggest("ml-notes", 3);
    expect(out).toEqual(["ml-notes-one", "ml-notes-two", "ml-notes-three"]);
  });

  it("includes year fallback if asked for more", () => {
    const out = suggest("ml-notes", 4);
    expect(out).toContain("ml-notes-2026");
  });

  it("respects the limit", () => {
    expect(suggest("x", 2)).toHaveLength(2);
    expect(suggest("x", 5)).toHaveLength(5);
  });

  it("dedups within the result set", () => {
    const out = suggest("ml-notes", 10);
    expect(new Set(out).size).toBe(out.length);
  });

  it("all suggestions pass slug validation", () => {
    const out = suggest("good-slug", 5);
    for (const s of out) {
      expect(s).toMatch(/^[a-z0-9]([a-z0-9-]{2,61})[a-z0-9]$/);
    }
  });

  it("does not include suggestions that are reserved", () => {
    // "admin-one" isn't reserved, but the validation guard ensures the
    // results don't contain any reserved slug.
    const out = suggest("admin");
    expect(out).not.toContain("admin");
    for (const s of out) {
      expect(s).not.toBe("admin");
    }
  });
});

describe("validateSuggestions", () => {
  it("keeps valid slugs, drops invalid", () => {
    expect(validateSuggestions(["good", "BAD", "abc"])).toEqual(["good"]);
  });

  it("dedups", () => {
    expect(validateSuggestions(["good", "good", "good"])).toEqual(["good"]);
  });

  it("returns empty for empty input", () => {
    expect(validateSuggestions([])).toEqual([]);
  });
});