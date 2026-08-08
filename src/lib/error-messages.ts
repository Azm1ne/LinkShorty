/**
 * Centralized mapping from API error codes ({ error: "rate-limited" } etc.)
 * to human-readable messages shown in the UI.
 *
 * Codes used by the API live in route handlers under `src/app/api/`. Keep
 * this in sync when adding a new error code on the API side.
 */
export function mapApiError(
  err: { error?: string } | null | undefined,
  fallback: string,
): string {
  const code = err?.error;
  switch (code) {
    case "rate-limited":
      return "Too many requests. Try again later.";
    case "invalid-input":
      return "Invalid input. Check the form and try again.";
    case "slug-taken":
      return "That slug is already taken.";
    case "taken":
      return "That slug is already taken.";
    case "auto-generation-failed":
      return "Could not generate a slug. Try again.";
    case "slug-invalid-chars":
      return "Slug may only contain lowercase letters, numbers, and hyphens.";
    case "slug-reserved":
      return "That slug is reserved.";
    case "slug-too-short":
    case "slug-too-long":
      return "Slug must be between 3 and 64 characters.";
    case "url-invalid":
      return "That URL isn't valid.";
    case "url-self":
      return "You can't shorten a link on this site.";
    case "url-blocked":
      return "That URL is blocked.";
    case "invalid-password":
      return "Wrong password.";
    case "missing-password":
      return "Enter the password.";
    case "not-found":
      return "Link not found.";
    case "unauthorized":
      return "Not authorized.";
    default:
      return fallback;
  }
}
