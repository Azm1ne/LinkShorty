import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { readLink, updateLink, deleteLink, findSlugByToken } from "@/lib/links";
import { hashEditToken } from "@/lib/hash";
import { validateUrl } from "@/lib/url";
import { clampExpiry } from "@/lib/expiry";
import { getOwnHost } from "@/lib/env";
import { isSameOriginRequest } from "@/lib/csrf";

// `validateUrl` now DNS-resolves the hostname (via `node:dns.promises.lookup`),
// which is Node-only. Pin this route to the Node runtime explicitly.
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

const PatchSchema = z
  .object({
    url: z.string().min(1).max(2048).optional(),
    expiresInMinutes: z.number().int().min(0).max(999_999).optional(),
    password: z.string().min(1).max(512).nullable().optional(),
  })
  .refine(
    (v) =>
      v.url !== undefined || v.expiresInMinutes !== undefined || v.password !== undefined,
    { message: "At least one field must be provided" },
  );

function ownHost(): string {
  return getOwnHost();
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { token } = await ctx.params;

  if (!(await isSameOriginRequest(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-input" },
      { status: 400 },
    );
  }

  const storage = getStorage();
  const slug = await findSlugByToken(storage, token);
  if (!slug) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const existing = await readLink(storage, slug);
  if (!existing) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const patch = parsed.data;

  if (patch.url !== undefined) {
    const urlResult = await validateUrl(patch.url, ownHost());
    if (!urlResult.ok) {
      return NextResponse.json({ error: urlResult.reason }, { status: 422 });
    }
    patch.url = urlResult.url;
  }

  if (patch.expiresInMinutes !== undefined) {
    const { minutes } = clampExpiry(patch.expiresInMinutes);
    patch.expiresInMinutes = minutes;
  }

  await updateLink(storage, slug, {
    url: patch.url,
    expiresAt:
      patch.expiresInMinutes !== undefined
        ? patch.expiresInMinutes === 0
          ? 0
          : Date.now() + patch.expiresInMinutes * 60_000
        : undefined,
    password: patch.password,
  });

  const updated = await readLink(storage, slug);
  return NextResponse.json({ slug, link: updated });
}

export async function DELETE(request: Request, ctx: RouteContext) {
  const { token } = await ctx.params;

  if (!(await isSameOriginRequest(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const storage = getStorage();
  const slug = await findSlugByToken(storage, token);
  if (!slug) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  await deleteLink(storage, slug, await hashEditToken(token));
  return NextResponse.json({ slug, deleted: true });
}