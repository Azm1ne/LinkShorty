/**
 * Hashing helpers. All use Web Crypto (crypto.subtle) so they work on Edge
 * runtime and Node 20+.
 *
 * - hashIp: SHA-256(ip + IP_SALT). Used for rate-limited counters and abuse
 *   tracing. Raw IP is never stored.
 * - hashEditToken: SHA-256(token). The token is shown once; only the hash is
 *   stored.
 * - hashPassword: SHA-256(password + slug). Slug acts as salt so identical
 *   passwords on different links produce different hashes.
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

export function hashPassword(password: string, slug: string): Promise<string> {
  return sha256Hex(password + slug);
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
