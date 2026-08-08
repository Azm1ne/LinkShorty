import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isOwnHost,
  isPrivateOrLoopbackHost,
  isIdnHost,
  isNumericIpPrivate,
  parseNumericIpLiteral,
  resolveIsPrivate,
  validateUrl,
} from "./url";

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

describe("isIdnHost", () => {
  it("matches xn-- prefixed hosts", () => {
    expect(isIdnHost("xn--80akhbyknj4f.example")).toBe(true);
    expect(isIdnHost("XN--Bcher-kva.example")).toBe(true);
  });

  it("matches labels containing xn--", () => {
    expect(isIdnHost("example.xn--p1ai")).toBe(true);
  });

  it("matches hosts with raw non-ASCII", () => {
    expect(isIdnHost("b\u00fccher.example")).toBe(true);
  });

  it("does not match plain ASCII hosts", () => {
    expect(isIdnHost("example.com")).toBe(false);
    expect(isIdnHost("sub.example.com")).toBe(false);
  });
});

describe("parseNumericIpLiteral", () => {
  it("parses dotted-quad", () => {
    expect(parseNumericIpLiteral("127.0.0.1")).toBe("127.0.0.1");
    expect(parseNumericIpLiteral("10.0.0.1")).toBe("10.0.0.1");
  });

  it("parses single decimal int", () => {
    expect(parseNumericIpLiteral("2130706433")).toBe("127.0.0.1");
    expect(parseNumericIpLiteral("0")).toBe("0.0.0.0");
  });

  it("parses hex (0x-) prefix", () => {
    expect(parseNumericIpLiteral("0x7f000001")).toBe("127.0.0.1");
  });

  it("parses octal (leading 0) prefix", () => {
    expect(parseNumericIpLiteral("017700000001")).toBe("127.0.0.1");
  });

  it("parses hex dotted form", () => {
    expect(parseNumericIpLiteral("0x7f.0x0.0x0.0x1")).toBe("127.0.0.1");
  });

  it("parses shortened IPv4 forms", () => {
    expect(parseNumericIpLiteral("127.1")).toBe("127.0.0.1");
    expect(parseNumericIpLiteral("127.0.1")).toBe("127.0.0.1");
  });

  it("returns null for non-numeric hosts", () => {
    expect(parseNumericIpLiteral("example.com")).toBe(null);
    expect(parseNumericIpLiteral("localhost")).toBe(null);
    expect(parseNumericIpLiteral("sub.example.com")).toBe(null);
  });

  it("returns null when a part of dotted form exceeds 255", () => {
    expect(parseNumericIpLiteral("300.0.0.1")).toBe(null);
  });
});

describe("isNumericIpPrivate", () => {
  it("detects decimal-encoded loopback", () => {
    expect(isNumericIpPrivate("2130706433")).toBe(true);
  });

  it("detects hex-encoded loopback", () => {
    expect(isNumericIpPrivate("0x7f000001")).toBe(true);
    expect(isNumericIpPrivate("0x7f.0x0.0x0.0x1")).toBe(true);
  });

  it("detects octal-encoded loopback", () => {
    expect(isNumericIpPrivate("017700000001")).toBe(true);
  });

  it("detects shortened IPv4 loopback", () => {
    expect(isNumericIpPrivate("127.1")).toBe(true);
    expect(isNumericIpPrivate("127.0.1")).toBe(true);
  });

  it("detects other RFC1918 forms", () => {
    expect(isNumericIpPrivate("167772161")).toBe(true); // 10.0.0.1
    expect(isNumericIpPrivate("3232235777")).toBe(true); // 192.168.1.1 (binary)
  });

  it("does not flag public IPs", () => {
    expect(isNumericIpPrivate("8.8.8.8")).toBe(false);
    expect(isNumericIpPrivate("134744072")).toBe(false); // 8.8.8.8 decimal
  });

  it("does not flag normal hostnames", () => {
    expect(isNumericIpPrivate("example.com")).toBe(false);
    expect(isNumericIpPrivate("google.com")).toBe(false);
  });
});

describe("resolveIsPrivate", () => {
  let lookupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const dns = await import("node:dns");
    lookupSpy = vi.spyOn(dns.promises, "lookup");
  });

  afterEach(() => {
    lookupSpy.mockRestore();
  });

  it("returns true when DNS resolves to a private IP", async () => {
    lookupSpy.mockResolvedValue([{ address: "10.0.0.1", family: 4 }] as never);
    expect(await resolveIsPrivate("attacker.example")).toBe(true);
  });

  it("returns true when DNS resolves to loopback", async () => {
    lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    expect(await resolveIsPrivate("loopback.example")).toBe(true);
  });

  it("returns false when DNS resolves to a public IP", async () => {
    lookupSpy.mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
    expect(await resolveIsPrivate("dns.google")).toBe(false);
  });

  it("returns false when DNS lookup fails", async () => {
    lookupSpy.mockRejectedValue(new Error("NXDOMAIN"));
    expect(await resolveIsPrivate("does-not-exist.example")).toBe(false);
  });

  it("flags any private address in a multi-A response", async () => {
    lookupSpy.mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ] as never);
    expect(await resolveIsPrivate("multi.example")).toBe(true);
  });
});

describe("validateUrl", () => {
  it("accepts an http URL", async () => {
    expect(await validateUrl("http://example.com/foo", OWN)).toEqual({
      ok: true,
      url: "http://example.com/foo",
    });
  });

  it("accepts an https URL", async () => {
    expect(await validateUrl("https://example.com/foo", OWN)).toEqual({
      ok: true,
      url: "https://example.com/foo",
    });
  });

  it("rejects invalid URLs", async () => {
    expect(await validateUrl("not a url", OWN)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await validateUrl("", OWN)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects javascript: protocol", async () => {
    expect(await validateUrl("javascript:alert(1)", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
  });

  it("rejects data:, file:, vbscript: protocols", async () => {
    expect(await validateUrl("data:text/plain,hello", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
    expect(await validateUrl("file:///etc/passwd", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
    expect(await validateUrl("vbscript:msgbox", OWN)).toEqual({
      ok: false,
      reason: "forbidden-protocol",
    });
  });

  it("rejects ftp:// and other non-http protocols", async () => {
    expect(await validateUrl("ftp://example.com", OWN)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects URLs pointing at our own domain", async () => {
    expect(
      await validateUrl("https://linkshorty.vercel.app/foo", OWN),
    ).toEqual({
      ok: false,
      reason: "self-redirect",
    });
  });

  it("rejects localhost destinations", async () => {
    expect(await validateUrl("http://localhost:8080/admin", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
  });

  it("rejects private IP destinations", async () => {
    expect(await validateUrl("http://192.168.1.10", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
    expect(await validateUrl("http://10.0.0.1", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
    expect(
      await validateUrl("http://169.254.169.254/latest/meta-data", OWN),
    ).toEqual({
      ok: false,
      reason: "private-host",
    });
  });

  it("rejects decimal-encoded loopback", async () => {
    expect(await validateUrl("http://2130706433/", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
  });

  it("rejects hex-encoded loopback", async () => {
    expect(await validateUrl("http://0x7f.0x0.0x0.0x1/", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
    expect(await validateUrl("http://0x7f000001/", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
  });

  it("rejects shortened IPv4 loopback", async () => {
    expect(await validateUrl("http://127.1/", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
    expect(await validateUrl("http://127.0.1/", OWN)).toEqual({
      ok: false,
      reason: "private-host",
    });
  });

  it("rejects IDN / punycode hostnames", async () => {
    expect(
      await validateUrl("http://xn--80akhbyknj4f.example/", OWN),
    ).toEqual({
      ok: false,
      reason: "idn-host",
    });
    expect(await validateUrl("http://example.xn--p1ai/", OWN)).toEqual({
      ok: false,
      reason: "idn-host",
    });
  });

  it("rejects domains that resolve to a private IP", async () => {
    const dns = await import("node:dns");
    const spy = vi
      .spyOn(dns.promises, "lookup")
      // Cast to the overload that returns LookupAddress[]; `all: true` triggers it.
      .mockResolvedValue([{ address: "10.0.0.1", family: 4 }] as never);
    try {
      expect(await validateUrl("http://rebinding.example.com/", OWN)).toEqual({
        ok: false,
        reason: "private-host",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects domains that resolve to cloud metadata", async () => {
    const dns = await import("node:dns");
    const spy = vi
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([
        { address: "169.254.169.254", family: 4 },
      ] as never);
    try {
      expect(await validateUrl("http://meta.example.com/", OWN)).toEqual({
        ok: false,
        reason: "private-host",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("accepts a normal public domain", async () => {
    const result = await validateUrl("https://example.com/foo", OWN);
    expect(result.ok).toBe(true);
  });

  it("normalizes the URL on success", async () => {
    const result = await validateUrl("https://EXAMPLE.com/Path?q=1", OWN);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.url.toLowerCase()).toContain("example.com");
    }
  });
});