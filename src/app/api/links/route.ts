import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { createLink, newEditToken, slugExists } from "@/lib/links";
import { validateSlug } from "@/lib/slug";
import { validateUrl } from "@/lib/url";
import { clampExpiry } from "@/lib/expiry";
import { hashIp } from "@/lib/hash";
import { getClientIp } from "@/lib/request";
import { generateAutoSlug } from "@/lib/auto-slug";

const RequestSchema = z.object({
  url: z.string().min(1).max(2048),
  slug: z.string().max(64).optional(),
  expiresInMinutes: z.number().int().min(0).max(999_999),
  password: z.string().min(1).max(512).nullable().optional(),
});

function ownHost(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/^https?:\/\//, "").replace(
      /\/.*$/,
      "",
    ) ?? "linkshorty.vercel.app"
  );
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

  const { url, expiresInMinutes, password } = parsed.data;
  const rawSlug = parsed.data.slug ?? "";

  // Validate URL first — it's a more useful error than a slug error if both
  // are bad.
  const urlResult = validateUrl(url, ownHost());
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

  const ip = getClientIp(request);
  const ipHash = await hashIp(ip, process.env.IP_SALT ?? "");
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

  const shortUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/${resolvedSlug}`;

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