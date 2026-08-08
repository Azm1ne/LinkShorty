import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { createLink, newEditToken, slugExists } from "@/lib/links";
import { validateSlug } from "@/lib/slug";
import { validateUrl } from "@/lib/url";
import { clampExpiry } from "@/lib/expiry";
import { hashIp } from "@/lib/hash";
import { getClientIp } from "@/lib/request";

const RequestSchema = z.object({
  url: z.string().min(1).max(2048),
  slug: z.string().min(1).max(64),
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

  const { url, slug, expiresInMinutes, password } = parsed.data;

  // Validate slug
  const slugResult = validateSlug(slug);
  if (!slugResult.ok) {
    return NextResponse.json({ error: slugResult.reason }, { status: 422 });
  }

  // Validate URL
  const urlResult = validateUrl(url, ownHost());
  if (!urlResult.ok) {
    return NextResponse.json({ error: urlResult.reason }, { status: 422 });
  }

  // Reject permanent in dev (no rate-limit yet — T10). For now just clamp.
  const { minutes } = clampExpiry(expiresInMinutes);
  const expiresAt = minutes === 0 ? 0 : Date.now() + minutes * 60_000;

  const storage = getStorage();
  if (await slugExists(storage, slugResult.slug)) {
    return NextResponse.json({ error: "slug-taken" }, { status: 409 });
  }

  const ip = getClientIp(request);
  const ipHash = await hashIp(ip, process.env.IP_SALT ?? "");
  const token = await newEditToken();

  await createLink(storage, {
    slug: slugResult.slug,
    url: urlResult.url,
    createdAt: Date.now(),
    expiresAt,
    password: password ?? null,
    ipHash,
    editTokenHash: token.hash,
  });

  const shortUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/${slugResult.slug}`;

  return NextResponse.json(
    {
      slug: slugResult.slug,
      shortUrl,
      editToken: token.token,
      expiresAt,
    },
    { status: 201 },
  );
}