import { describe, expect, it } from "vitest";
import { isOwnHost, isPrivateOrLoopbackHost, validateUrl } from "./url";

const OWN = "linkshorty.vercel.app";

describe("isOwnHost", () => {
  it("matches the configured domain case-insensitively", () => {
    expect(isOwnHost("linkshorty.vercel.app", OWN)).toBe(true);
    expect(isOwnHost("LINKSHORTY.VERCEL.APP", OWN)).toBe(true);
  });

  it("does not match a different host", () => {
    expect(isOwnHost("example.com", OWN)).toBe(false);
  });

  it("does not match a subdomain", () => {
    expect(isOwnHost("api.linkshorty.vercel.app", OWN)).toBe(false);
  });
});

describe("isPrivateOrLoopbackHost", () => {
  it("matches localhost", () => {
    expect(isPrivateOrLoopbackHost("localhost")).toBe(true);
    expect(isPrivateOrLoopbackHost("LOCALHOST")).toBe(true);
  });

  it("matches IPv4 loopback", () => {
    expect(isPrivateOrLoopbackHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("0.0.0.0")).toBe(true);
  });

  it("matches RFC1918 private ranges", () => {
    expect(isPrivateOrLoopbackHost("10.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("192.168.1.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.31.255.255")).toBe(true);
  });

  it("does not match 172.32 or 172.15 (boundary cases)", () => {
    expect(isPrivateOrLoopbackHost("172.32.0.1")).toBe(false);
    expect(isPrivateOrLoopbackHost("172.15.0.1")).toBe(false);
  });

  it("matches link-local (cloud metadata)", () => {
    expect(isPrivateOrLoopbackHost("169.254.169.254")).toBe(true);
  });

  it("matches IPv6 loopback", () => {
    expect(isPrivateOrLoopbackHost("::1")).toBe(true);
  });

  it("does not match public hosts", () => {
    expect(isPrivateOrLoopbackHost("example.com")).toBe(false);
    expect(isPrivateOrLoopbackHost("8.8.8.8")).toBe(false);
  });
});

describe("validateUrl", () => {
  it("accepts an http URL", () => {
    expect(validateUrl("http://example.com/foo", OWN)).toEqual({
      ok: true,
      url: "http://example.com/foo",
    });
  });

  it("accepts an https URL", () => {
    expect(validateUrl("https://example.com/foo", OWN)).toEqual({
      ok: true,
      url: "https://example.com/foo",
    });
  });

  it("rejects invalid URLs", () => {
    expect(validateUrl("not a url", OWN)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(validateUrl("", OWN)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects javascript: protocol", () => {
    expect(validateUrl("javascript:alert(1)", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
  });

  it("rejects data:, file:, vbscript: protocols", () => {
    expect(validateUrl("data:text/plain,hello", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
    expect(validateUrl("file:///etc/passwd", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
    expect(validateUrl("vbscript:msgbox", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
  });

  it("rejects ftp:// and other non-http protocols", () => {
    expect(validateUrl("ftp://example.com", OWN)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects URLs pointing at our own domain", () => {
    expect(validateUrl("https://linkshorty.vercel.app/foo", OWN)).toEqual({
      ok: false,
      reason: "self-redirect",
    });
  });

  it("rejects localhost destinations", () => {
    expect(validateUrl("http://localhost:8080/admin", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
  });

  it("rejects private IP destinations", () => {
    expect(validateUrl("http://192.168.1.10", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
    expect(validateUrl("http://10.0.0.1", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
    expect(validateUrl("http://169.254.169.254/latest/meta-data", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
  });

  it("normalizes the URL on success", () => {
    const result = validateUrl("https://EXAMPLE.com/Path?q=1", OWN);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.url.toLowerCase()).toContain("example.com");
    }
  });
});