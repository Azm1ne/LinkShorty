/**
 * POST /api/admin/login
 *
 * Body: { password: string }
 *
 * Single-password gate. On success, sets a signed `ls_admin` cookie valid
 * for 7 days. On failure, returns 401. Password attempts are rate-limited
 * per IP (5 per 15 min) to slow brute force.
 *
 * The submitted password is compared to `ADMIN_PASSWORD` using a SHA-256
 * digest of each side, then `crypto.subtle.verify` (constant-time HMAC).
 * Going through SHA-256 first lets us do a length-stable comparison — the
 * alternative is `timingSafeEqual` on padded buffers, which works but is
 * fiddlier.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { hashIp } from "@/lib/hash";
import { getClientIp } from "@/lib/request";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_OPTIONS,
  signAdminCookie,
} from "@/lib/cookie";

const RequestSchema = z.object({
  password: z.string().min(1).max(2048),
});

const enc = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return bytesToHex(new Uint8Array(buf));
}

/**
 * Constant-time digest comparison. Both inputs are SHA-256 hex strings so
 * lengths are equal. We still keep the loop constant-time against the
 * full length.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) {
    // Refuse to operate without a configured password. Surface as a 500 so
    // ops notices an unconfigured deployment, not a generic 401.
    return NextResponse.json(
      { error: "admin-not-configured" },
      { status: 500 },
    );
  }

  // Rate limit BEFORE the comparison. We still increment on success: the
  // spec is "5 attempts per 15 min" — successful login only counts as one
  // attempt, but the failure path is the concern.
  const storage = getStorage();
  const ip = getClientIp(request);
  const ipHash = await hashIp(ip, process.env.IP_SALT ?? "");
  const rl = await checkRateLimit(storage, "admin-login", ipHash);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSeconds, "admin-login");
  }

  const submittedDigest = await sha256Hex(parsed.data.password);
  const expectedDigest = await sha256Hex(expected);
  if (!constantTimeEqual(submittedDigest, expectedDigest)) {
    return NextResponse.json({ error: "invalid-password" }, { status: 401 });
  }

  const cookieValue = await signAdminCookie();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: cookieValue,
    httpOnly: ADMIN_COOKIE_OPTIONS.httpOnly,
    sameSite: ADMIN_COOKIE_OPTIONS.sameSite,
    path: ADMIN_COOKIE_OPTIONS.path,
    secure: isProd(),
    maxAge: ADMIN_COOKIE_OPTIONS.maxAgeSeconds,
  });
  return res;
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}
