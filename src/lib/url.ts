/**
 * URL validation. Rejects:
 *   - Anything that doesn't parse as http(s)
 *   - javascript:, data:, file:, vbscript: — `javascript:` is a stored XSS via
 *     open redirect
 *   - URLs pointing at the shortener's own domain — redirect loops
 *   - Private and loopback hosts (SSRF probes against internal infra)
 */

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
        | "loopback-host";
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

export function validateUrl(
  input: string,
  ownHost: string,
): UrlValidation {
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

  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return { ok: false, reason: "private-host" };
  }

  return { ok: true, url: parsed.toString() };
}