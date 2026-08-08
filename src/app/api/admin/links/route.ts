/**
 * GET   /api/admin/links?offset=&limit=&search=
 * DELETE /api/admin/links   body: { slug }
 *
 * Admin-only. Both verbs require a valid `ls_admin` cookie.
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
import { deleteLink } from "@/lib/links";
import { listLinks } from "@/lib/admin-list";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/lib/cookie";

const DeleteSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "invalid-slug"),
});

/**
 * Extract the `ls_admin` cookie value from a `Cookie` header. Returns the
 * decoded raw value or null if absent.
 *
 * Next.js encodes cookie values when they contain characters outside the
 * cookie-octet range, so we decode here. The signing scheme sees the raw
 * `|` separators.
 */
function readCookieValue(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== ADMIN_COOKIE_NAME) continue;
    let raw = part.slice(eq + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

async function requireAdmin(request: Request): Promise<boolean> {
  const raw = readCookieValue(request);
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

  const body = await request.json().catch(() => null);
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  await deleteLink(getStorage(), parsed.data.slug);
  return NextResponse.json({ slug: parsed.data.slug, deleted: true });
}
