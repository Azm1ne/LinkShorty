/**
 * The reserved-slug list. Anything in here is rejected at validation time
 * because it would collide with an app route, or because it's a high-value
 * squatting target.
 *
 * Slugs under 4 characters are already covered by the length rule, so the
 * list focuses on 4+ character names.
 */
export const RESERVED_SLUGS = new Set<string>([
  "api",
  "admin",
  "login",
  "logout",
  "signup",
  "register",
  "dashboard",
  "settings",
  "edit",
  "new",
  "create",
  "delete",
  "s",
  "static",
  "public",
  "assets",
  "favicon",
  "about",
  "help",
  "support",
  "terms",
  "privacy",
  "contact",
  "status",
  "health",
  "robots",
  "sitemap",
  "manifest",
  "_next",
  "www",
  "mail",
  "ftp",
  "cdn",
  "app",
]);