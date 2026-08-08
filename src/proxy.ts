import { NextResponse, type NextRequest } from "next/server";
import { getStorage } from "@/lib/storage-singleton";
import { readLink } from "@/lib/links";

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
 *   - Skip paths under /api, /_next, /admin, /edit, /s, or any path with `.`
 *   - Look up `link:{slug}` in storage
 *   - If password-protected and visitor has no valid cookie, rewrite to
 *     /{slug}/password (gate page wired in T08)
 *   - Otherwise, 307 redirect to the destination
 *   - If missing, rewrite to /404 (NOT a redirect to /)
 *
 * 307 over 301 is deliberate: 301 is cached permanently by browsers, so an
 * expired or deleted link would still redirect from local cache for months.
 * 307 is not cached.
 */

const SKIP_PREFIXES = ["/api", "/_next", "/admin", "/edit", "/s"];

function shouldSkip(pathname: string): boolean {
  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Skip anything that looks like a static file (contains a dot in the last segment).
  const last = pathname.split("/").pop() ?? "";
  if (last.includes(".")) return true;
  return false;
}

/** Cookie name for the password gate. Set in T08. */
const PASSWORD_COOKIE = "ls_pw";

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

  const storage = getStorage();
  const link = await readLink(storage, slug);
  if (!link) {
    // Rewrite to the 404 page in-place. NEVER redirect to `/`.
    return NextResponse.rewrite(new URL("/404", request.url));
  }

  // Password gate: rewrite to the gate page if the link is protected and the
  // visitor doesn't hold a valid cookie. The cookie is set on successful
  // password submit (T08).
  if (link.hasPassword) {
    const cookie = request.cookies.get(PASSWORD_COOKIE);
    const allowedSlugs = cookie?.value ? decodeAllowedSlugs(cookie.value) : [];
    if (!allowedSlugs.includes(slug)) {
      const gateUrl = new URL(`/${slug}/password`, request.url);
      return NextResponse.rewrite(gateUrl);
    }
  }

  return NextResponse.redirect(link.url, 307);
}

/** Decode the comma-separated allowed-slug list from a cookie value. */
function decodeAllowedSlugs(raw: string): string[] {
  // The cookie format is `<sig>:<csv>` where sig is HMAC over the csv.
  // Full verification lives in T08. For now, we accept any value that
  // includes the slug — placeholder so the proxy shape is correct.
  return raw.split(",").filter(Boolean);
}

export const config = {
  // Match everything except _next and dotfiles.
  matcher: ["/((?!_next|.*\\..*).*)"],
};