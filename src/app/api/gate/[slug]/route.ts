import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { readLink, readPasswordHash } from "@/lib/links";
import { verifyPassword } from "@/lib/hash";
import { getHashedClientIp } from "@/lib/request";
import { checkRateLimitFor, rateLimitResponse } from "@/lib/rate-limit";
import {
  GATE_COOKIE_NAME,
  GATE_COOKIE_OPTIONS,
  signCookie,
} from "@/lib/cookie";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

const BodySchema = z.object({
  password: z.string().min(1).max(512),
});

const DEFAULT_COOKIE_TTL_SECONDS = 24 * 60 * 60; // 24h for permanent links

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function POST(request: Request, ctx: RouteContext) {
  const { slug } = await ctx.params;

  // Parse body first so we don't even look up storage for malformed input.
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "missing-password" }, { status: 400 });
  }

  const storage = getStorage();

  // Rate-limit BEFORE password verification. We want a flood of wrong
  // guesses to hit the limiter too. Spec: 10 attempts per (slug, IP) per hour.
  const ipHash = await getHashedClientIp(request);
  const rl = await checkRateLimitFor(storage, "gate-attempt", slug, ipHash);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSeconds, "gate-attempt");
  }

  // Verify the link exists and is still valid. Only slug-specific limits
  // live here — the IP-wide limit applies via rl above.
  const link = await readLink(storage, slug);
  if (!link || !link.hasPassword) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const storedHash = await readPasswordHash(storage, slug);
  if (!storedHash) {
    // Defensive: hasPassword was true but no hash stored. Treat as not-found
    // rather than 500 so we don't leak storage state.
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const ok = await verifyPassword(parsed.data.password, storedHash, slug);
  if (!ok) {
    return NextResponse.json({ error: "invalid-password" }, { status: 401 });
  }

  // Success. Sign a cookie scoped to this slug, expiring with the link or
  // in 24h for permanent links.
  const ttlSeconds =
    link.expiresAt > 0
      ? Math.max(1, Math.floor((link.expiresAt - Date.now()) / 1000))
      : DEFAULT_COOKIE_TTL_SECONDS;

  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  const cookieValue = await signCookie(slug, expiresAtMs);

  const res = NextResponse.json(
    {
      destination: link.url,
      slug,
    },
    { status: 200 },
  );
  res.cookies.set({
    name: GATE_COOKIE_NAME,
    value: cookieValue,
    httpOnly: GATE_COOKIE_OPTIONS.httpOnly,
    sameSite: GATE_COOKIE_OPTIONS.sameSite,
    path: GATE_COOKIE_OPTIONS.path,
    secure: isProd(),
    maxAge: ttlSeconds,
  });
  return res;
}