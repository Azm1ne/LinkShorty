import { describe, expect, it } from "vitest";
import { buildStorage } from "./storage-singleton";
import { MemoryStorage } from "./storage-memory";
import { UpstashStorage } from "./storage-upstash";

describe("buildStorage factory", () => {
  it("throws in production when KV env vars are missing", () => {
    expect(() =>
      buildStorage({ NODE_ENV: "production" }),
    ).toThrow(/KV_REST_API_URL/);
  });

  it("does not throw in dev when KV env vars are missing", () => {
    expect(() =>
      buildStorage({ NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("returns MemoryStorage when KV env vars are missing in dev", () => {
    expect(buildStorage({ NODE_ENV: "development" })).toBeInstanceOf(MemoryStorage);
  });

  it("returns UpstashStorage when both KV env vars are set", () => {
    expect(
      buildStorage({
        NODE_ENV: "production",
        KV_REST_API_URL: "https://example.com",
        KV_REST_API_TOKEN: "token",
      }),
    ).toBeInstanceOf(UpstashStorage);
  });

  it("still throws when only one of the two KV env vars is set in production", () => {
    expect(() =>
      buildStorage({
        NODE_ENV: "production",
        KV_REST_API_URL: "https://example.com",
      }),
    ).toThrow(/KV_REST_API_URL/);
  });
});
