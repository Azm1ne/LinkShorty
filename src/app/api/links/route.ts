import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { createLink, newEditToken, slugExists } from "@/lib/links";
import { validateSlug } from "@/lib/slug";
import { validateUrl } from "@/lib/url";
import { clampExpiry } from "@/lib/expiry";
import { getHashedClientIp } from "@/lib/request";
import { generateAutoSlug } from "@/lib/auto-slug";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getBaseUrl, getOwnHost } from "@/lib/env";
import { isSameOriginRequest } from "@/lib/csrf";

// `validateUrl` now DNS-resolves the hostname (via `node:dns.promises.lookup`),
// which is Node-only. Pin this route to the Node runtime explicitly — the
// routes file doesn't otherwise require Node, so the default isn't reliable.
export const runtime = "nodejs";

const RequestSchema = z.object({
  url: z.string().min(1).max(2048),
  slug: z.string().max(64).optional(),
  expiresInMinutes: z.number().int().min(0).max(999_999),
  password: z.string().min(1).max(512).nullable().optional(),
});

function ownHost(): string {
  return getOwnHost();
}

export async function POST(request: Request) {
  if (!(await isSameOriginRequest(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-input" },
      { status: 400 },
    );
  }

  const { url, expiresInMinutes, password } = parsed.data;
  const rawSlug = parsed.data.slug ?? "";

  // Validate URL first — it's a more useful error than a slug error if both
  // are bad.
  const urlResult = await validateUrl(url, ownHost());
  if (!urlResult.ok) {
    return NextResponse.json({ error: urlResult.reason }, { status: 422 });
  }

  // Resolve the slug. Empty input → auto-generate. Non-empty → validate.
  let resolvedSlug: string;
  if (rawSlug.trim() === "") {
    let attempt = 0;
    while (attempt < 5) {
      const candidate = generateAutoSlug();
      const result = validateSlug(candidate);
      if (result.ok && !(await slugExists(getStorage(), result.slug))) {
        resolvedSlug = result.slug;
        break;
      }
      attempt++;
    }
    if (!resolvedSlug!) {
      return NextResponse.json(
        { error: "auto-generation-failed" },
        { status: 500 },
      );
    }
  } else {
    const slugResult = validateSlug(rawSlug);
    if (!slugResult.ok) {
      return NextResponse.json({ error: slugResult.reason }, { status: 422 });
    }
    resolvedSlug = slugResult.slug;
  }

  // Reject permanent in dev (no rate-limit yet — T10). For now just clamp.
  const { minutes } = clampExpiry(expiresInMinutes);
  const expiresAt = minutes === 0 ? 0 : Date.now() + minutes * 60_000;

  const storage = getStorage();
  if (await slugExists(storage, resolvedSlug)) {
    return NextResponse.json({ error: "slug-taken" }, { status: 409 });
  }

  // Atomically claim the slug so two requests that both pass the existence
  // check can't both proceed into createLink and race. SET NX on a dedicated
  // key — short TTL so a claim can never get stuck if createLink fails
  // after this point.
  const claimed = await storage.set(`slug-claim:${resolvedSlug}`, "1", {
    nx: true,
    exSeconds: 30,
  });
  if (!claimed) {
    return NextResponse.json({ error: "slug-taken" }, { status: 409 });
  }

  const ipHash = await getHashedClientIp(request);

  // Tiered rate limit (T10): after validation, before persisting.
  const rateTier = minutes > 0 ? "create-expiring" : "create-permanent";
  const rl = await checkRateLimit(storage, rateTier, ipHash);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSeconds, rateTier);
  }

  const token = await newEditToken();

  await createLink(storage, {
    slug: resolvedSlug,
    url: urlResult.url,
    createdAt: Date.now(),
    expiresAt,
    password: password ?? null,
    ipHash,
    editTokenHash: token.hash,
  });

  const shortUrl = `${getBaseUrl()}/${resolvedSlug}`;

  return NextResponse.json(
    {
      slug: resolvedSlug,
      shortUrl,
      editToken: token.token,
      expiresAt,
    },
    { status: 201 },
  );
}