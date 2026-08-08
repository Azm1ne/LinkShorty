/**
 * Cross-site request defence for state-changing endpoints.
 *
 * SameSite=Strict on the admin cookie blocks the common CSRF case, but a
 * subdomain takeover or a browser bug could still share the cookie. We
 * layer an Origin check on top: every state-changing request must have
 * an `Origin` header that matches the deployment's own origin.
 *
 * The check is intentionally simple — we don't pull in a CSRF-token
 * library because we have no HTML form lifetime to protect. API endpoints
 * only.
 *
 * `GET` and `HEAD` are exempt by definition. Browsers don't send a
 * meaningful `Origin` for top-level GETs, and we don't perform state
 * changes on GETs anyway.
 */

import { getOwnHost } from "./env";

/**
 * Returns `true` when the request's `Origin` header matches the deployment
 * origin (or when the request is a safe method GET/HEAD). Returns `false`
 * for state-changing requests from a different origin.
 *
 * In dev (no `NEXT_PUBLIC_BASE_URL`), the helper falls back to allowing
 * any origin so smoke-testing from POSTman/curl works.
 */
export async function isSameOriginRequest(request: Request): Promise<boolean> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header — typically a server-to-server POST or a curl from
    // the same machine. Reject for state-changing endpoints in production,
    // because the absence of Origin on a real browser is itself suspicious.
    if (process.env.NODE_ENV === "production") return false;
    return true;
  }

  let ownHost: string;
  try {
    ownHost = getOwnHost();
  } catch {
    // In production, `getOwnHost` throws when `NEXT_PUBLIC_BASE_URL` is
    // unset. That's a deployment-config error — fail closed.
    return false;
  }

  return isSameOrigin(origin, ownHost);
}

/**
 * Pure helper: returns true when the given `Origin` header value has the
 * same host as `ownHost`. Extracted so it can be unit-tested without
 * mutating `process.env`.
 */
export function isSameOrigin(originHeader: string, ownHost: string): boolean {
  let originHost: string;
  try {
    const parsed = new URL(originHeader);
    originHost = parsed.host;
  } catch {
    return false;
  }
  return originHost === ownHost;
}
