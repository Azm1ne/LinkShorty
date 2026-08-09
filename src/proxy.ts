import { NextResponse, type NextRequest } from "next/server";
import { getStorage } from "@/lib/storage-singleton";
import { readLink, readPasswordHash } from "@/lib/links";
import { GATE_COOKIE_NAME, verifyCookie } from "@/lib/cookie";
import { assertProductionEnv } from "@/lib/env";

// Validate required env vars at boot. The proxy runs on every request, so
// this fires on the first request to a missing-var deployment and surfaces
// a 500 instead of a confusing 404 / redirect-loop. In dev/test, no-ops.
assertProductionEnv();

/**
 * Next.js 16 proxy. Runs on Edge before any route handler.
 *
 * Critical: this file MUST be named `proxy.ts`. Naming it `middleware.ts`
 * silently does nothing on Next.js 16 — no error, no warning, just 404s on
 * every short link.
 *
 * Location: at the project root OR in `src/` when the `src/` directory
 * convention is enabled. We're using `src/`, so this file lives at
 * `src/proxy.ts`.
 *
 * Hot-path logic:
 *   - Skip paths under /api, /_next, /admin, /edit, /s/, or any path with `.`
 *   - Look up `link:{slug}` in storage
 *   - If password-protected and visitor has no valid cookie, rewrite to
 *     /{slug}/password
 *   - Otherwise, 307 redirect to the destination
 *   - If missing, rewrite to /404 (NOT a redirect to /)
 *
 * 307 over 301 is deliberate: 301 is cached permanently by browsers, so an
 * expired or deleted link would still redirect from local cache for months.
 * 307 is not cached.
 */

const SKIP_PREFIXES = ["/api", "/_next", "/admin", "/edit", "/s/"];

function shouldSkip(pathname: string): boolean {
  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Skip anything that looks like a static file (contains a dot in the last segment).
  const last = pathname.split("/").pop() ?? "";
  if (last.includes(".")) return true;
  return false;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (shouldSkip(pathname)) {
    return NextResponse.next();
  }

  const slug = pathname.slice(1).toLowerCase();
  if (!slug) {
    // Visiting `/` is the create page, not a redirect. Let it through.
    return NextResponse.next();
  }

  // Don't try to gate the gate page itself. The rewrite below targets this
  // path; if it ever slipped past, we should fall through to the route
  // handler instead of looping.
  if (pathname.endsWith("/password")) {
    return NextResponse.next();
  }

  const storage = getStorage();
  const link = await readLink(storage, slug);
  if (!link) {
    // Rewrite to the 404 page in-place. NEVER redirect to `/`.
    return NextResponse.rewrite(new URL("/404", request.url));
  }

  // Password gate: rewrite to the gate page if the link is protected and the
  // visitor doesn't hold a valid signed cookie for this slug.
  if (link.hasPassword) {
    const currentHash = (await readPasswordHash(storage, slug)) ?? "";
    const cookie = request.cookies.get(GATE_COOKIE_NAME);
    const grant = cookie?.value
      ? await verifyCookie(cookie.value, currentHash)
      : null;
    if (!grant || grant.slug !== slug) {
      const gateUrl = new URL(`/${slug}/password`, request.url);
      return NextResponse.rewrite(gateUrl);
    }
  }

  return NextResponse.redirect(link.url, 307);
}

export const config = {
  // Match everything except _next and dotfiles.
  matcher: ["/((?!_next|.*\\..*).*)"],
};