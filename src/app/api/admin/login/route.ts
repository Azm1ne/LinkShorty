/**
 * POST /api/admin/login
 *
 * Body: { password: string }
 *
 * Single-password gate. On success, sets a signed `ls_admin` cookie valid
 * for 7 days. On failure, returns 401. Password attempts are rate-limited
 * per IP (5 per 15 min) to slow brute force.
 *
 * The submitted password is compared to `ADMIN_PASSWORD` via SHA-256 digests
 * compared with `constantTimeEqualHex` from `@/lib/hash`. SHA-256 first lets
 * us do a length-stable comparison (both sides are 64 hex chars).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { constantTimeEqualHex, hashIp, sha256Hex } from "@/lib/hash";
import { getClientIp } from "@/lib/request";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getAdminPassword, getIpSalt } from "@/lib/env";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_OPTIONS,
  signAdminCookie,
} from "@/lib/cookie";

const RequestSchema = z.object({
  password: z.string().min(1).max(2048),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  let expected: string;
  try {
    expected = getAdminPassword();
  } catch {
    // Logged server-side via the thrown error in env.ts. Don't echo the
    // thrown message to the client — it could include file paths or
    // deployment details.
    return NextResponse.json(
      { error: "admin-not-configured" },
      { status: 500 },
    );
  }
  if (!expected) {
    return NextResponse.json(
      { error: "admin-not-configured" },
      { status: 500 },
    );
  }

  const storage = getStorage();
  const ip = getClientIp(request);
  const ipHash = await hashIp(ip, getIpSalt());
  const rl = await checkRateLimit(storage, "admin-login", ipHash);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSeconds, "admin-login");
  }

  const submittedDigest = await sha256Hex(parsed.data.password);
  const expectedDigest = await sha256Hex(expected);
  if (!constantTimeEqualHex(submittedDigest, expectedDigest)) {
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