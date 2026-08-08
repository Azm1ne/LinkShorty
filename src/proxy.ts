import { NextResponse, type NextRequest } from "next/server";

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
 * Hot-path logic (will be replaced in T04):
 *   - Skip paths under /api, /_next, /admin, /edit, /s, or any path with `.`
 *   - Look up `link:{slug}` in storage (currently a hardcoded map)
 *   - If found, 307 redirect to the destination
 *   - If missing, rewrite to /404 (NOT a redirect to /)
 *
 * 307 over 301 is deliberate: 301 is cached permanently by browsers, so an
 * expired or deleted link would still redirect from local cache for months.
 * 307 is not cached.
 */

const SKIP_PREFIXES = ["/api", "/_next", "/admin", "/edit", "/s"];

/** T03 hardcoded map. Replaced by Redis lookup in T04. */
const TRACER_SLUGS: Record<string, string> = {
  test: "https://example.com",
};

function shouldSkip(pathname: string): boolean {
  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Skip anything that looks like a static file (contains a dot in the last segment).
  const last = pathname.split("/").pop() ?? "";
  if (last.includes(".")) return true;
  return false;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (shouldSkip(pathname)) {
    return NextResponse.next();
  }

  const slug = pathname.slice(1).toLowerCase();
  if (!slug) {
    // Visiting `/` is the create page, not a redirect. Let it through.
    return NextResponse.next();
  }

  const destination = TRACER_SLUGS[slug];
  if (!destination) {
    // Rewrite to the 404 page in-place. NEVER redirect to `/`.
    return NextResponse.rewrite(new URL("/404", request.url));
  }

  return NextResponse.redirect(destination, 307);
}

export const config = {
  // Match everything except _next and dotfiles.
  matcher: ["/((?!_next|.*\\..*).*)"],
};