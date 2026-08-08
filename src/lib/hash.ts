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
 */

const enc = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
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