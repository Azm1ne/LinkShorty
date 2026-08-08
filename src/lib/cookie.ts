/**
 * Signed cookie helpers for the password gate and the admin session.
 *
 * Cookie payload format (gate):  `slug|expiresAtMs|hmacHex`
 * Cookie payload format (admin): `admin|<expiresAtMs>|1|<hmacHex>`
 *
 *   - hmacHex   HMAC-SHA-256 over the rest of the payload, keyed by
 *               COOKIE_SECRET, hex-encoded
 *
 * The gate cookie name is `ls_gate` (a single shared cookie — the slug is
 * part of the payload, not the cookie name). This avoids any issue where a
 * slug starts with a digit or contains characters that browsers reject in
 * cookie names.
 *
 * The admin cookie uses an `admin` namespace so a forged slug-shaped payload
 * from the gate cookie can't trick an admin verifier.
 *
 * Signing primitives come from `@/lib/hash` so this file is the only place
 * the cookie *shape* lives, but the *crypto* is centralised.
 */

import { constantTimeEqualHex, hmacHex } from "@/lib/hash";

export const GATE_COOKIE_NAME = "ls_gate";
export const ADMIN_COOKIE_NAME = "ls_admin";
const ADMIN_NAMESPACE = "admin";
const ADMIN_MARKER = "1";
const ADMIN_COOKIE_LIFETIME_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface GateGrant {
  slug: string;
  expiresAtMs: number;
}

export interface AdminGrant {
  expiresAtMs: number;
}

function getSecret(): string {
  return process.env.COOKIE_SECRET ?? "";
}

async function signPayload(message: string): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error("COOKIE_SECRET is not configured");
  }
  return hmacHex(secret, message);
}

async function verifyPayload(message: string, expectedHex: string): Promise<boolean> {
  const secret = getSecret();
  if (!secret) return false;
  const actual = await hmacHex(secret, message);
  return constantTimeEqualHex(actual, expectedHex);
}

/**
 * Sign a gate cookie value. Returns the encoded `slug|expiresAtMs|hmacHex`
 * string ready to write to a cookie.
 */
export async function signCookie(slug: string, expiresAtMs: number): Promise<string> {
  const message = `${slug}|${expiresAtMs}`;
  const sig = await signPayload(message);
  return `${message}|${sig}`;
}

/**
 * Verify a gate cookie value. Returns the parsed payload when the HMAC is
 * valid AND the expiry is in the future; otherwise null.
 *
 * Returns null (never throws) on malformed input, bad signature, wrong secret,
 * or expired grant.
 */
export async function verifyCookie(raw: string): Promise<GateGrant | null> {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 3) return null;
  const [slug, expiresStr, sig] = parts;
  if (!slug || !expiresStr || !sig) return null;

  const expiresAtMs = Number(expiresStr);
  if (!Number.isFinite(expiresAtMs)) return null;
  if (expiresAtMs <= Date.now()) return null;

  const ok = await verifyPayload(`${slug}|${expiresAtMs}`, sig);
  if (!ok) return null;

  return { slug, expiresAtMs };
}

/**
 * Sign a fresh admin-session cookie. Returns the encoded value to set on
 * Set-Cookie.
 */
export async function signAdminCookie(): Promise<string> {
  const expiresAtMs = Date.now() + ADMIN_COOKIE_LIFETIME_SECONDS * 1000;
  const message = `${ADMIN_NAMESPACE}|${expiresAtMs}|${ADMIN_MARKER}`;
  const sig = await signPayload(message);
  return `${message}|${sig}`;
}

/**
 * Verify an admin cookie value. Returns the parsed grant when the HMAC is
 * valid and the expiry is in the future; otherwise null.
 */
export async function verifyAdminCookie(
  raw: string | undefined | null,
): Promise<AdminGrant | null> {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 4) return null;
  const [namespace, expiresStr, marker, sig] = parts;
  if (namespace !== ADMIN_NAMESPACE) return null;
  if (marker !== ADMIN_MARKER) return null;
  if (!expiresStr || !sig) return null;

  const expiresAtMs = Number(expiresStr);
  if (!Number.isFinite(expiresAtMs)) return null;
  if (expiresAtMs <= Date.now()) return null;

  const ok = await verifyPayload(
    `${namespace}|${expiresAtMs}|${marker}`,
    sig,
  );
  if (!ok) return null;

  return { expiresAtMs };
}

/**
 * Extract a named cookie's raw value from a request's `Cookie` header.
 * Returns the decoded value (handles Next.js's quoted + percent-encoded
 * values), or null if absent.
 *
 * Exposed so admin API routes can verify the cookie without depending on
 * `next/headers` (which requires a request context that isn't available
 * in unit tests).
 */
export function readCookieFromRequest(
  request: Request,
  name: string,
): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    let raw = part.slice(eq + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Cookie attributes for the gate cookie. Centralised so the API route and
 * the proxy stay in sync.
 */
export const GATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // `secure` is decided at call sites because Node vs Edge don't both expose
  // the request URL uniformly. Callers pass `secure` based on env.
};

/**
 * Cookie attributes for the admin session. Built here so the login route and
 * any future middleware that needs to clear the cookie stay in sync.
 */
export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  maxAgeSeconds: ADMIN_COOKIE_LIFETIME_SECONDS,
};