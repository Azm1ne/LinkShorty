/**
 * Request helpers: client IP extraction and the standard hashed-IP shape used
 * for rate-limit and abuse-tracing keys.
 *
 * `getClientIp` returns the raw IP. `getHashedClientIp` folds `getClientIp`
 * + `hashIp` + the `IP_SALT` env lookup into one call so route handlers
 * never forget the salt.
 *
 * For tests, `X-Test-Client-IP` takes precedence ONLY in non-production so
 * a deterministic smoke-test IP can be injected without depending on Next.js's
 * dev-server loopback rewrite. In production, the test header is ignored —
 * trusting it there would let an attacker rotate IPs at will to dodge
 * per-IP rate limits.
 */
import { hashIp } from "./hash";
import { getIpSalt } from "./env";

export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  // Test-only escape hatch. We do NOT honour this in production — see the
  // module-level note above.
  if (process.env.NODE_ENV !== "production") {
    const testIp = request.headers.get("x-test-client-ip");
    if (testIp) return testIp.trim();
  }
  return "unknown";
}

/**
 * Resolve the client IP and hash it with `IP_SALT` in one call. The standard
 * pre-storage shape for any rate-limit or abuse-tracing key — use this rather
 * than `getClientIp` + `hashIp` separately so the salt lookup is never
 * forgotten.
 */
export async function getHashedClientIp(request: Request): Promise<string> {
  const ip = getClientIp(request);
  return hashIp(ip, getIpSalt());
}