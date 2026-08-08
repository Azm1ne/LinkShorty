/**
 * Centralised environment-variable validation.
 *
 * Reading a missing or empty `process.env.X` silently falls through to `""`
 * in most code paths. In production that turns into "your cookies all verify
 * as invalid" or "your admin password matches anything" — quiet failures
 * that are hard to spot from the request path alone.
 *
 * Each helper here returns the configured value or, in production, throws
 * a single descriptive error. In dev / test it returns `""` so the existing
 * dev secrets in `.env.local` keep working and tests don't need a setup step.
 *
 * Call sites wrap reads in these helpers rather than touching `process.env`
 * directly. That makes the failure surface narrow and traceable.
 */

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Validate required production secrets exist. Called once at the start of
 * any code path that depends on them. Throws in production if anything is
 * missing; in dev/test it just logs once and returns.
 */
export function assertProductionEnv(): void {
  if (!isProd()) return;

  const missing: string[] = [];
  for (const name of [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "COOKIE_SECRET",
    "IP_SALT",
    "ADMIN_PASSWORD",
    "NEXT_PUBLIC_BASE_URL",
  ]) {
    if (!process.env[name]) missing.push(name);
  }

  if (missing.length) {
    throw new Error(
      "Missing required environment variables: " +
        missing.join(", ") +
        ". See DEPLOY.md for setup.",
    );
  }

  // COOKIE_SECRET should be at least 32 chars to give HMAC-SHA-256 enough
  // entropy to matter. We don't reject below that — we'd rather be permissive
  // than block legitimate deployments — but log a warning.
  const secret = process.env.COOKIE_SECRET ?? "";
  if (secret.length < 32) {
    console.warn(
      "[env] COOKIE_SECRET is shorter than 32 characters; consider " +
        "regenerating with `openssl rand -base64 32`.",
    );
  }
}

/** Get the cookie-signing secret. Throws in production if missing. */
export function getCookieSecret(): string {
  if (isProd()) assertProductionEnv();
  return process.env.COOKIE_SECRET ?? "";
}

/** Get the IP-hashing salt. Throws in production if missing. */
export function getIpSalt(): string {
  if (isProd()) assertProductionEnv();
  return process.env.IP_SALT ?? "";
}

/** Get the admin password. Throws in production if missing. */
export function getAdminPassword(): string {
  if (isProd()) assertProductionEnv();
  return process.env.ADMIN_PASSWORD ?? "";
}

/**
 * Get the deployment's own host. Used for self-redirect detection in
 * `validateUrl`. In production the operator MUST set `NEXT_PUBLIC_BASE_URL`
 * to the deployment domain — without it, every URL to the shortener looks
 * like a valid destination and we get redirect loops. In dev we fall back
 * to `localhost:3000`.
 */
export function getOwnHost(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.replace(
    /^https?:\/\//,
    "",
  ).replace(/\/.*$/, "");
  if (configured) return configured;
  if (isProd()) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL is not set in production. " +
        "Set it to the deployment domain (e.g. https://your-app.vercel.app).",
    );
  }
  return "localhost:3000";
}

/** Base URL used when constructing short-link responses shown to the user. */
export function getBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (isProd()) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL is not set in production. " +
        "Set it to the deployment domain (e.g. https://your-app.vercel.app).",
    );
  }
  return "http://localhost:3000";
}