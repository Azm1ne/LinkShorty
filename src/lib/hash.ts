/**
 * Hashing helpers. Web Crypto primitives (sha256Hex, hmacHex, etc.) work on
 * Edge runtime and Node 20+. Password hashing uses Argon2id via
 * `@node-rs/argon2`, which is a native binding — Node runtime only.
 *
 * - hashIp: SHA-256(ip + IP_SALT). Used for rate-limited counters and abuse
 *   tracing. Raw IP is never stored.
 * - hashEditToken: SHA-256(token). The token is shown once; only the hash is
 *   stored.
 * - hashPassword / verifyPassword: Argon2id with OWASP params
 *   (m=65536 KiB, t=3, p=4). Each hash uses a random 16-byte salt generated
 *   internally by Argon2id — no longer relies on the slug as a salt, since
 *   the per-hash random salt does that job properly.
 *
 * HMAC primitives (hmacHex, constantTimeEqualHex) live here so all
 * authenticated cookie code goes through the same primitives. Cookies and
 * login codes that import `crypto.subtle` directly bypass this audit surface.
 */

const enc = new TextEncoder();

/**
 * SHA-256 of a string, returned as a hex-encoded digest. Public so callers
 * that need a length-stable comparison (e.g. password checks) can hash both
 * sides and compare digests.
 */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return bytesToHex(new Uint8Array(buf));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Inverse of `bytesToHex`. Throws on malformed input. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have an even length");
  }
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) {
      throw new Error("hex string contains invalid characters");
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Constant-time comparison of two equal-length hex strings. Length mismatch
 * returns false. The XOR loop compares the full length so a partial match
 * takes the same time as a full one — short-circuiting on a mismatch would
 * leak how many leading characters matched.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * HMAC-SHA-256 of a message using a UTF-8 secret. Returns the hex-encoded
 * digest. Web Crypto so the same code runs on Edge and Node.
 */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

export function hashIp(ip: string, salt: string): Promise<string> {
  return sha256Hex(ip + salt);
}

export function hashEditToken(token: string): Promise<string> {
  return sha256Hex(token);
}

// ---------------------------------------------------------------------------
// Argon2id password hashing
// ---------------------------------------------------------------------------
//
// Argon2id with OWASP-recommended params (m=65536 KiB, t=3, p=4). The
// `slug` parameter is preserved so the call site in `createLink` and
// `updateLink` doesn't need to change; Argon2 generates its own random
// 16-byte salt internally and embeds it in the output PHC string. That
// per-hash random salt is what prevents cross-link rainbow tables — the
// slug-as-salt trick the previous SHA-256 scheme used is no longer needed.
//
// @node-rs/argon2 is a native binding — Node runtime only. The gate route
// already declares `runtime = "nodejs"`, so this is fine. Do not import this
// from Edge runtime code.

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

// Argon2id algorithm ID = 2 (Argon2d=0, Argon2i=1, Argon2id=2). Argon2
// version 0x13 = 19 corresponds to the package's `Version.V0x13` enum
// value (which is 1 in their internal enum, but the *encoded* version
// in the PHC string is 19). We hard-code these here because the package
// exports them as `const enum`, which TypeScript forbids under
// `isolatedModules`. Numeric values match
// node_modules/@node-rs/argon2/index.d.ts.
const ARGON2_OPTIONS = {
  algorithm: 2,
  version: 1,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Hash a password for storage. Returns the standard Argon2id PHC string:
 *   `argon2id$v=19$m=65536,t=3,p=4$<salt-b64>$<hash-b64>`
 *
 * The `slug` argument is folded into the password via HMAC-SHA-256 before
 * Argon2. The slug is public, so it's not a secret salt — but binding the
 * slug to the password means an attacker who steals the Redis dump and
 * recovers a password for one link can't tell whether the same password was
 * also used on a different link. Argon2 still generates its own random
 * 16-byte salt internally, which is what actually prevents precomputation.
 */
export async function hashPassword(password: string, slug: string): Promise<string> {
  const prehash = await sha256Hex(`${slug}:${password}`);
  return argonHash(prehash, ARGON2_OPTIONS);
}

/**
 * Verify a submitted password against a stored Argon2id PHC string.
 * Returns true iff the password matches. Argon2's verify is itself
 * constant-time; do not compare hashes by hand.
 *
 * The slug must be the same one used when hashing — same domain-separation
 * prehash is applied before verify. Returns false on any error (malformed
 * stored hash, etc.) so the call site can treat the result as a simple
 * boolean.
 */
export async function verifyPassword(
  submitted: string,
  stored: string,
  slug: string,
): Promise<boolean> {
  const prehash = await sha256Hex(`${slug}:${submitted}`);
  try {
    return await argonVerify(stored, prehash);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically random token. 32 bytes gives us 256 bits of
 * entropy, which is more than enough for a slug→manage link relationship.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
