/**
 * Expiry clamping. Server is the authority — client validation is a courtesy
 * to honest users. Anyone can `curl` with `expiresInMinutes: 999999999`.
 *
 * - 0 → permanent (no TTL)
 * - [1, 43200] minutes → accepted (1 minute to 30 days)
 * - < 1 or > 43200 → clamped to nearest bound, with a flag the caller can
 *   surface in the UI ("Over the 30 day ceiling — clamped to 30 days")
 */

export const MIN_EXPIRY_MINUTES = 1;
export const MAX_EXPIRY_MINUTES = 43_200; // 30 days
export const DEFAULT_EXPIRY_MINUTES = 1_440; // 24 hours

export type ExpiryClampResult = {
  /** Final expiry value used: 0 for permanent, otherwise minutes. */
  minutes: number;
  /** Whether the original input was outside the accepted range. */
  clamped: boolean;
  /** Which bound the input crossed, if any. */
  direction?: "min" | "max";
};

export function clampExpiry(input: number): ExpiryClampResult {
  if (input === 0) return { minutes: 0, clamped: false };
  // NaN — collapse to the min bound. Treating NaN as "below min" matches
  // how user input failures usually present.
  if (Number.isNaN(input)) {
    return { minutes: MIN_EXPIRY_MINUTES, clamped: true, direction: "min" };
  }
  // Infinity — collapse to the max bound. Anything else not-finite (just
  // NaN now, since the NaN check above took it) is treated as below min.
  if (!Number.isFinite(input)) {
    return { minutes: MAX_EXPIRY_MINUTES, clamped: true, direction: "max" };
  }
  if (input < MIN_EXPIRY_MINUTES) {
    return { minutes: MIN_EXPIRY_MINUTES, clamped: true, direction: "min" };
  }
  if (input > MAX_EXPIRY_MINUTES) {
    return { minutes: MAX_EXPIRY_MINUTES, clamped: true, direction: "max" };
  }
  return { minutes: Math.floor(input), clamped: false };
}

/** Pretty-print a future expiry in plain English. */
export function formatExpiry(now: Date, expiresAt: Date): string {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return "Already expired";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Less than a minute from now";
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} from now`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} from now`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} from now`;
}