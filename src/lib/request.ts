/**
 * Extract the client IP from a request. Vercel's edge forwards
 * `x-forwarded-for` (and `x-real-ip` as a fallback). The first entry in
 * x-forwarded-for is the original client.
 *
 * For tests, this can return a stub via the X-Test-Client-Ip header.
 *
 * The returned IP is *raw* — callers hash it before any storage operation.
 */
export function getClientIp(request: Request): string {
  // Tests inject a deterministic IP via this header. In dev/test, Next.js
  // rewrites x-forwarded-for to the loopback address for every request, so
  // the test header must take precedence there. In production, this header
  // is never set by clients, so it stays as a no-op.
  const testIp = request.headers.get("x-test-client-ip");
  if (testIp && process.env.NODE_ENV !== "production") {
    return testIp.trim();
  }
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  if (testIp) return testIp.trim();
  return "unknown";
}