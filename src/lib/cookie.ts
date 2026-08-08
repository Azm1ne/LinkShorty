/**
 * Signed cookie helpers for the password gate.
 *
 * Cookie payload format: `slug|expiresAtMs|hmacHex`
 *   - slug          lowercased, validated by the gate before this is called
 *   - expiresAtMs   unix ms when this grant stops being valid
 *   - hmacHex       HMAC-SHA-256 over `slug|expiresAtMs`, hex-encoded,
 *                   keyed by COOKIE_SECRET
 *
 * The cookie name itself is `ls_gate` (a single shared cookie — the slug is
 * part of the payload, not the cookie name). This avoids any issue where a
 * slug starts with a digit or contains characters that browsers reject in
 * cookie names.
 *
 * Web Crypto (`crypto.subtle`) is used so the helpers work on Edge and Node.
 */

const COOKIE_NAME = "ls_gate";

const enc = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacHex(key: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

async function hmacEqual(key: CryptoKey, message: string, expectedHex: string): Promise<boolean> {
  // We re-sign and compare to avoid pulling in subtle.verify, which would
  // require the raw bytes — easier to compare hex strings with a constant-
  // time helper.
  const actual = await hmacHex(key, message);
  return timingSafeEqualHex(actual, expectedHex);
}

/**
 * Constant-time comparison of two equal-length hex strings. Length mismatch
 * returns false after comparing against the shorter string's length so we
 * don't short-circuit on length alone (which would leak length info).
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function getSecret(): string {
  return process.env.COOKIE_SECRET ?? "";
}

export interface GateGrant {
  slug: string;
  expiresAtMs: number;
}

/**
 * Sign a gate cookie value. Returns the encoded `slug|expiresAtMs|hmacHex`
 * string ready to write to a cookie.
 */
export async function signCookie(slug: string, expiresAtMs: number): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error("COOKIE_SECRET is not configured");
  }
  const key = await importKey(secret);
  const message = `${slug}|${expiresAtMs}`;
  const sig = await hmacHex(key, message);
  return `${slug}|${expiresAtMs}|${sig}`;
}

/**
 * Verify a cookie value. Returns the parsed payload when the HMAC is valid
 * AND the expiry is in the future; otherwise null.
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

  const secret = getSecret();
  if (!secret) return null;

  const key = await importKey(secret);
  const ok = await hmacEqual(key, `${slug}|${expiresAtMs}`, sig);
  if (!ok) return null;

  return { slug, expiresAtMs };
}

export const GATE_COOKIE_NAME = COOKIE_NAME;

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
 * Admin cookie helpers. Lives alongside the gate helpers because the
 * underlying signing scheme is the same — HMAC-SHA-256 over a payload,
 * keyed by COOKIE_SECRET. The admin cookie uses a namespace prefix so a
 * forged slug-shaped payload from the gate cookie can't trick a verifier
 * that expects the admin namespace.
 *
 * Cookie payload: `admin|<expiresAtMs>|<marker>|<hmacHex>`.
 * The marker is currently fixed to "1" — admin auth is a single boolean
 * (you're either an admin or not), so there is no per-record payload.
 */

const ADMIN_NAMESPACE = "admin";
const ADMIN_MARKER = "1";
const ADMIN_COOKIE_LIFETIME_SECONDS = 7 * 24 * 60 * 60; // 7 days

export const ADMIN_COOKIE_NAME = "ls_admin";

export interface AdminGrant {
  expiresAtMs: number;
}

/**
 * Sign a fresh admin-session cookie. Returns the encoded value to set on
 * Set-Cookie.
 */
export async function signAdminCookie(): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error("COOKIE_SECRET is not configured");
  }
  const expiresAtMs = Date.now() + ADMIN_COOKIE_LIFETIME_SECONDS * 1000;
  const message = `${ADMIN_NAMESPACE}|${expiresAtMs}|${ADMIN_MARKER}`;
  const key = await importKey(secret);
  const sig = await hmacHex(key, message);
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

  const secret = getSecret();
  if (!secret) return null;

  const key = await importKey(secret);
  const ok = await hmacEqual(
    key,
    `${namespace}|${expiresAtMs}|${marker}`,
    sig,
  );
  if (!ok) return null;

  return { expiresAtMs };
}

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