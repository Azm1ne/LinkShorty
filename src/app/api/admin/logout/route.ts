/**
 * POST /api/admin/logout
 *
 * Clears the `ls_admin` cookie by setting it with `Max-Age=0`. The browser
 * drops the cookie on the next read, so subsequent requests to admin
 * routes are unauthenticated.
 *
 * The cookie is set with `httpOnly: true` on login, so client-side
 * `document.cookie = "ls_admin=; …"` cannot clear it — only a
 * `Set-Cookie` response header from the server can. Hence this route.
 *
 * CSRF: this is a state-changing request, so we run the same-origin
 * check as every other mutating route. The endpoint is idempotent —
 * calling it without a valid admin cookie still returns 200 and tries
 * to clear any stale cookie the browser may have.
 */

import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/csrf";
import { ADMIN_COOKIE_NAME, ADMIN_COOKIE_OPTIONS } from "@/lib/cookie";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isSameOriginRequest(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: ADMIN_COOKIE_OPTIONS.httpOnly,
    sameSite: ADMIN_COOKIE_OPTIONS.sameSite,
    path: ADMIN_COOKIE_OPTIONS.path,
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return res;
}
