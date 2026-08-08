/**
 * URL validation. Rejects:
 *   - Anything that doesn't parse as http(s)
 *   - javascript:, data:, file:, vbscript: — `javascript:` is a stored XSS via
 *     open redirect
 *   - URLs pointing at the shortener's own domain — redirect loops
 *   - Private and loopback hosts (SSRF probes against internal infra)
 *
 * Host-name attacks we explicitly defend against beyond a literal-string
 * check:
 *   - Numeric IP literals in decimal / hex / octal / shortened form
 *     (`http://2130706433`, `http://0x7f.0x0.0x0.0x1`, `http://127.1`) —
 *     `URL` parses these to `127.0.0.1` so the existing range check catches
 *     them, but we double-check before the DNS step in case the parser
 *     changes behaviour.
 *   - IDN / punycode hostnames (`xn--…`) — these can encode look-alikes of
 *     internal hostnames and break naive string checks.
 *   - Domains that resolve to a private/loopback IP via DNS (DNS rebinding
 *     / SSRF).
 *
 * `dns.promises.lookup` is Node-only, so this module is Node-only. The
 * routes that call `validateUrl` are pinned to `runtime = "nodejs"`.
 */

import { isIP } from "node:net";
import dns from "node:dns";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const FORBIDDEN_PROTOCOLS = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
]);

export type UrlValidation =
  | { ok: true; url: string }
  | {
      ok: false;
      reason:
        | "invalid"
        | "forbidden-protocol"
        | "self-redirect"
        | "private-host"
        | "loopback-host"
        | "idn-host";
    };

/** Hosts that point at our own deployment. Anything matching is a redirect loop.
 *  Compare the host alone — ports don't affect "this is our deployment".
 */
export function isOwnHost(host: string, ownHost: string): boolean {
  // Strip any port from ownHost for comparison (URL.hostname never has a port)
  const ownHostOnly = ownHost.split(":")[0]?.toLowerCase() ?? "";
  return host.toLowerCase() === ownHostOnly;
}

/**
 * True if the host is loopback or in a private IP range. We block these so
 * the shortener can't be turned into an SSRF probe.
 *
 * The check is host-string based, not IP-numeric, because most of the time
 * we're comparing against a hostname like `localhost` or `db.internal`. The
 * Upstash-fetches-URL flow doesn't depend on numeric IP resolution — it just
 * needs to reject the obvious cases.
 */
export function isPrivateOrLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase();

  if (lower === "localhost") return true;
  if (lower === "ip6-localhost" || lower === "ip6-loopback") return true;

  // IPv6 loopback
  if (lower === "::1" || lower === "[::1]") return true;

  // IPv4 loopback
  if (lower === "127.0.0.1" || lower === "0.0.0.0") return true;

  // RFC1918 private ranges
  if (
    lower.startsWith("10.") ||
    lower.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)
  ) {
    return true;
  }

  // Link-local (cloud metadata!)
  if (lower.startsWith("169.254.")) return true;

  // IPv6 unique local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  return false;
}

/**
 * True if the host is an internationalised domain (punycode-encoded).
 *
 * Node's `URL` keeps the raw `xn--…` form in `hostname`, so we just check the
 * literal label. We also flag any label that contains raw non-ASCII so we
 * catch bare unicode if a future URL parser ever passes it through.
 */
export function isIdnHost(host: string): boolean {
  const lower = host.toLowerCase();
  // Punycode prefix — every IDN label starts with `xn--` when encoded.
  if (lower.startsWith("xn--") || lower.includes(".xn--")) return true;
  // Raw non-ASCII (defence in depth — shouldn't normally appear in hostname).
  for (let i = 0; i < host.length; i++) {
    if (host.charCodeAt(i) > 127) return true;
  }
  return false;
}

/**
 * Try to parse a numeric IPv4 literal in any of: dotted-quad, single decimal,
 * hex (`0x7f000001`), octal (`0177…`), or shortened form (`127.1`). Returns
 * the canonical dotted-quad, or `null` if it isn't a numeric literal.
 *
 * `net.isIP` only recognises dotted-quad and `::1`, so we hand-roll the rest.
 * Each part may be decimal, hex (`0x…`), or octal (leading `0`); per RFC 3986
 * the parser uses C-style `0`-prefix = octal. We deliberately reject anything
 * that isn't strictly digits + dots + `x` + leading-zero so a real hostname
 * never falls through.
 */
export function parseNumericIpLiteral(host: string): string | null {
  const lower = host.toLowerCase();

  // Shortened IPv4: `127.1`, `127.0.1` etc. — 2 or 3 dot-separated parts that
  // are themselves decimal-encoded ints in [0, 255]. Detect by the form
  // "int.int[.int]" where the string contains dots but isn't a full 4-part.
  // We only treat shortened forms when `net.isIP` says no.
  if (netIsIp(lower)) {
    return lower;
  }

  // Single-integer form (decimal, hex, or octal).
  if (/^[0-9a-fx.]+$/.test(lower) && !lower.includes(".")) {
    const n = parseLiteralNumber(lower);
    if (n !== null && n >= 0 && n <= 0xffffffff) {
      return longToIpv4(n);
    }
    return null;
  }

  // Dotted form with 2 / 3 / 4 parts.
  const parts = lower.split(".");
  if (parts.length < 2 || parts.length > 4) return null;
  if (!parts.every((p) => p !== "")) return null;

  // 4-part dotted: every part must parse as a literal number in [0, 255].
  if (parts.length === 4) {
    if (!parts.every((p) => /^[0-9a-fx]+$/.test(p))) return null;
    const vals: number[] = [];
    for (const p of parts) {
      const v = parseLiteralNumber(p);
      if (v === null || v < 0 || v > 0xff) return null;
      vals.push(v);
    }
    return vals.join(".");
  }

  // 2- or 3-part "shortened" dotted form per inet_aton(3): the last part is
  // treated as the low bits of a 32-bit integer; leading parts are full bytes.
  // Example: `127.1` → 127<<24 | 1 = 0x7f000001 → 127.0.0.1.
  // We require every part to be a valid numeric literal (decimal / hex /
  // octal) — no empty parts, no wildcards.
  if (!parts.every((p) => /^[0-9a-fx]+$/.test(p))) return null;
  const vals: number[] = [];
  for (const p of parts) {
    const v = parseLiteralNumber(p);
    if (v === null || v < 0) return null;
    vals.push(v);
  }
  // First `parts.length - 1` values are full bytes; the last is the low bits.
  const headBytes = parts.length - 1;
  if (!vals.every((v, i) => (i < headBytes ? v <= 0xff : true))) return null;
  const last = vals[vals.length - 1]!;
  const head = vals.slice(0, headBytes);
  // Last part encodes the trailing bits: 8 * headBytes bits of head + rest.
  const totalBits = 8 * headBytes;
  if (last < 0 || last >= 1 << (32 - totalBits)) return null;
  const combined =
    (head[0] << 24) |
    ((head[1] ?? 0) << 16) |
    ((head[2] ?? 0) << 8) |
    last;
  return longToIpv4(combined >>> 0);
}

/** Parse a single numeric token — decimal, hex (`0x…`), or octal (leading `0`). */
function parseLiteralNumber(token: string): number | null {
  if (token === "") return null;
  if (/^0x[0-9a-f]+$/.test(token)) {
    return parseInt(token.slice(2), 16);
  }
  if (/^0[0-9]+$/.test(token)) {
    return parseInt(token, 8);
  }
  if (/^[0-9]+$/.test(token)) {
    return parseInt(token, 10);
  }
  return null;
}

function longToIpv4(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join(".");
}

/** True iff `host` is a numeric IP literal AND the resolved IP is private/loopback. */
export function isNumericIpPrivate(host: string): boolean {
  const lower = host.toLowerCase();
  // Fast path: dotted-quad / `::1` — `net.isIP` already detects these.
  const family = netIsIp(lower);
  if (family !== 0) {
    return isPrivateOrLoopbackHost(lower);
  }
  // Slow path: numeric in some other form. We deliberately only run this
  // for hosts whose character set is digits / hex / dots — a real hostname
  // never matches.
  if (!/^[0-9a-f.x]+$/.test(lower)) return false;
  const parsed = parseNumericIpLiteral(lower);
  if (parsed === null) return false;
  return isPrivateOrLoopbackHost(parsed);
}

/**
 * DNS-resolve `host` and return true if any returned address is in a
 * private / loopback range. Used to catch DNS-rebinding style SSRF where
 * the hostname looks public but resolves to internal infra.
 *
 * Resolves with `{ family: 4 }` to bias towards A records; on lookup
 * failure (NXDOMAIN, timeout, etc.) we treat the host as not-private so the
 * request fails naturally later rather than us masking it.
 */
export async function resolveIsPrivate(host: string): Promise<boolean> {
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { family: 4, all: true });
  } catch {
    return false;
  }
  for (const { address } of addresses) {
    if (isPrivateOrLoopbackHost(address)) return true;
  }
  return false;
}

export async function validateUrl(
  input: string,
  ownHost: string,
): Promise<UrlValidation> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (FORBIDDEN_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: "forbidden-protocol" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: "invalid" };
  }

  // Check self-redirect BEFORE private-host. localhost:3000 in dev is both
  // a self-redirect (it's our own domain) and a private-host, but the
  // self-redirect message is more accurate and avoids confusion in dev.
  if (isOwnHost(parsed.hostname, ownHost)) {
    return { ok: false, reason: "self-redirect" };
  }

  // Reject IDN / punycode hosts — they can encode look-alikes of internal
  // names and bypass string-level checks. We do this BEFORE the private-host
  // check because `localhost.xn--…` would otherwise be rejected as
  // `private-host` with a misleading message.
  if (isIdnHost(parsed.hostname)) {
    return { ok: false, reason: "idn-host" };
  }

  // Numeric IP literals in any form (decimal / hex / shortened).
  if (isNumericIpPrivate(parsed.hostname)) {
    return { ok: false, reason: "private-host" };
  }

  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return { ok: false, reason: "private-host" };
  }

  // The host looks like a normal public name. Resolve it to make sure it
  // doesn't secretly point at internal infra (DNS rebinding / SSRF).
  // This is the only step that hits the network; everything above is local.
  if (await resolveIsPrivate(parsed.hostname)) {
    return { ok: false, reason: "private-host" };
  }

  return { ok: true, url: parsed.toString() };
}

// Local alias so the helper above reads cleanly without leaking the
// `node:net` import into call-site logic.
function netIsIp(host: string): number {
  return isIP(host);
}