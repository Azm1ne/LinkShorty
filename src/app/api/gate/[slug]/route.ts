import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { getStorage } from "@/lib/storage-singleton";
import { readLink, readPasswordHash } from "@/lib/links";
import { hashIp, hashPassword } from "@/lib/hash";
import { getClientIp } from "@/lib/request";
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

const GATE_WINDOW_SECONDS = 3_600; // 1 hour
const GATE_LIMIT = 10;
const DEFAULT_COOKIE_TTL_SECONDS = 24 * 60 * 60; // 24h for permanent links

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function POST(request: Request, ctx: RouteContext) {
  const { slug } = await ctx.params;
  if (!slug) {
    return NextResponse.json({ error: "missing-slug" }, { status: 400 });
  }

  // Parse body first so we don't even look up storage for malformed input.
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "missing-password" }, { status: 400 });
  }

  const storage = getStorage();

  // Resolve IP once — used both for rate limiting and hashing.
  const ip = getClientIp(request);
  const ipSalt = process.env.IP_SALT ?? "";
  const ipHash = await hashIp(ip, ipSalt);

  // Rate limit BEFORE password verification. We want a flood of wrong
  // guesses to hit the limiter too.
  const rateKey = `rate:gate:${slug}:${ipHash}`;
  const { count } = await storage.incrWithTtl(rateKey, GATE_WINDOW_SECONDS);
  if (count > GATE_LIMIT) {
    const ttl = await storage.ttl(rateKey);
    const retryAfter = ttl !== null && ttl > 0 ? ttl : 60;
    return NextResponse.json(
      {
        error: "rate-limited",
        retryAfterSeconds: retryAfter,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }

  // Verify the link exists and is still valid.
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

  const submittedHash = await hashPassword(parsed.data.password, slug);

  // Constant-time comparison. Both sides are SHA-256 → 64 hex chars → 32
  // bytes, so timingSafeEqual on Buffers works.
  let passwordMatches = false;
  try {
    const a = Buffer.from(storedHash, "hex");
    const b = Buffer.from(submittedHash, "hex");
    if (a.length === b.length) {
      passwordMatches = timingSafeEqual(a, b);
    }
    // length mismatch → passwordMatches stays false
  } catch {
    passwordMatches = false;
  }

  if (!passwordMatches) {
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