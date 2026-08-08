/**
 * GET   /api/admin/links?offset=&limit=&search=
 * DELETE /api/admin/links   body: { slug }
 *
 * Admin-only. Both verbs require a valid `ls_admin` cookie. State-changing
 * verbs (DELETE here) ALSO require an Origin header that matches the
 * deployment origin — same-site defence in depth on top of SameSite=Strict.
 *
 * GET returns `{ links, total, offset, limit }`. Newest-first. When
 * `search` is a slug prefix, results are filtered to that prefix and
 * paginated within the filtered set.
 *
 * DELETE removes both the link hash and its index entry via `deleteLink`.
 *
 * The cookie is read from the raw `Cookie` header rather than `next/headers`
 * `cookies()` so the route is unit-testable from a Node request without a
 * request context. The /admin page (server component) also reads the cookie
 * the same way for the same reason.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage-singleton";
import { deleteLink, readEditTokenHash } from "@/lib/links";
import { listLinks } from "@/lib/admin-list";
import {
  ADMIN_COOKIE_NAME,
  readCookieFromRequest,
  verifyAdminCookie,
} from "@/lib/cookie";
import { isSameOriginRequest } from "@/lib/csrf";

const DeleteSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "invalid-slug"),
});

/**
 * Verify the request holds a valid admin session. Reads the cookie from the
 * raw `Cookie` header (rather than `next/headers` `cookies()`) so this route
 * stays unit-testable from a Node Request without a request context. The
 * `/admin` page server component uses `next/headers` for the same cookie —
 * both paths run the same `verifyAdminCookie` against the same value.
 */
async function requireAdmin(request: Request): Promise<boolean> {
  const raw = readCookieFromRequest(request, ADMIN_COOKIE_NAME);
  if (!raw) return false;
  const grant = await verifyAdminCookie(raw);
  return grant !== null;
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const search = url.searchParams.get("search") ?? "";

  const result = await listLinks(getStorage(), {
    offset: Number.isFinite(offset) ? offset : 0,
    limit: Number.isFinite(limit) ? limit : 50,
    search,
  });

  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await isSameOriginRequest(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-input" },
      { status: 400 },
    );
  }

  const slug = parsed.data.slug;
  const editTokenHash = await readEditTokenHash(getStorage(), slug);
  await deleteLink(getStorage(), slug, editTokenHash ?? "");
  return NextResponse.json({ slug, deleted: true });
}
