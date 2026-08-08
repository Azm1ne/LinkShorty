import { afterEach, describe, expect, it } from "vitest";
import { isSameOrigin, isSameOriginRequest } from "./csrf";

describe("isSameOrigin", () => {
  it("matches identical host", () => {
    expect(isSameOrigin("https://linkshorty.vercel.app", "linkshorty.vercel.app")).toBe(true);
  });

  it("rejects different host", () => {
    expect(isSameOrigin("https://evil.com", "linkshorty.vercel.app")).toBe(false);
  });

  it("rejects malformed origin", () => {
    expect(isSameOrigin("not-a-url", "linkshorty.vercel.app")).toBe(false);
  });

  it("treats different ports as different origins", () => {
    expect(isSameOrigin("https://linkshorty.vercel.app:8443", "linkshorty.vercel.app")).toBe(false);
  });
});

describe("isSameOriginRequest", () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
  });

  function makeRequest(method: string, origin?: string | null): Request {
    const headers = new Headers();
    if (origin !== null) {
      if (origin) headers.set("origin", origin);
    }
    return new Request("https://linkshorty.vercel.app/api/test", {
      method,
      headers,
    });
  }

  it("allows GET and HEAD regardless of origin", async () => {
    expect(await isSameOriginRequest(makeRequest("GET"))).toBe(true);
    expect(await isSameOriginRequest(makeRequest("HEAD"))).toBe(true);
    expect(await isSameOriginRequest(makeRequest("GET", "https://evil.com"))).toBe(true);
  });

  it("rejects POST from a different origin", async () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://linkshorty.vercel.app";
    const req = makeRequest("POST", "https://evil.com");
    expect(await isSameOriginRequest(req)).toBe(false);
  });

  it("accepts POST from the deployment origin", async () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://linkshorty.vercel.app";
    const req = makeRequest("POST", "https://linkshorty.vercel.app");
    expect(await isSameOriginRequest(req)).toBe(true);
  });
});
