import { describe, expect, it } from "vitest";
import {
  MAX_SLUG_LENGTH,
  MIN_SLUG_LENGTH,
  validateSlug,
} from "./slug";

describe("validateSlug", () => {
  it("accepts a normal slug", () => {
    expect(validateSlug("ml-notes")).toEqual({ ok: true, slug: "ml-notes" });
  });

  it("lowercases before validating", () => {
    expect(validateSlug("ML-Notes")).toEqual({ ok: true, slug: "ml-notes" });
    expect(validateSlug("DB")).toEqual({ ok: false, reason: "too-short" });
  });

  it("trims whitespace", () => {
    expect(validateSlug("  ml-notes  ")).toEqual({
      ok: true,
      slug: "ml-notes",
    });
  });

  it("rejects too-short slugs", () => {
    expect(validateSlug("ab")).toEqual({ ok: false, reason: "too-short" });
    expect(validateSlug("a")).toEqual({ ok: false, reason: "too-short" });
    expect(validateSlug("")).toEqual({ ok: false, reason: "too-short" });
    expect(validateSlug("   ")).toEqual({ ok: false, reason: "too-short" });
  });

  it(`rejects exactly ${MIN_SLUG_LENGTH - 1} chars`, () => {
    const slug = "a".repeat(MIN_SLUG_LENGTH - 1);
    expect(validateSlug(slug)).toEqual({ ok: false, reason: "too-short" });
  });

  it(`accepts exactly ${MIN_SLUG_LENGTH} chars`, () => {
    const slug = "a".repeat(MIN_SLUG_LENGTH);
    expect(validateSlug(slug)).toEqual({ ok: true, slug });
  });

  it(`accepts exactly ${MAX_SLUG_LENGTH} chars`, () => {
    const slug = "a".repeat(MAX_SLUG_LENGTH);
    expect(validateSlug(slug)).toEqual({ ok: true, slug });
  });

  it(`rejects over ${MAX_SLUG_LENGTH} chars`, () => {
    const slug = "a".repeat(MAX_SLUG_LENGTH + 1);
    expect(validateSlug(slug)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects leading hyphen", () => {
    expect(validateSlug("-abc")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects trailing hyphen", () => {
    expect(validateSlug("abc-")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects consecutive hyphens", () => {
    expect(validateSlug("a--bc")).toEqual({
      ok: false,
      reason: "consecutive-hyphens",
    });
  });

  it("rejects uppercase and special chars", () => {
    expect(validateSlug("ML_Notes")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("ml notes")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("ml.notes")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("ml/notes")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects reserved slugs that pass the length check", () => {
    // Use reserved slugs that are 4+ chars so the reserved check, not the
    // length check, is what fires.
    expect(validateSlug("admin")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("edit")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("static")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("robots")).toEqual({ ok: false, reason: "reserved" });
  });

  it("rejects reserved slugs that are also too short (length check fires first)", () => {
    // Reserved list contains `api`, `s`, `www` — all under 4 chars. The
    // length rule already catches these, so the test is that those still
    // don't sneak through.
    expect(validateSlug("api")).toEqual({ ok: false, reason: "too-short" });
    expect(validateSlug("s")).toEqual({ ok: false, reason: "too-short" });
  });
});