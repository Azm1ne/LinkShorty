import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage-singleton";
import { readLink } from "@/lib/links";
import { validateSlug } from "@/lib/slug";
import { suggest } from "@/lib/suggestions";
import { getHashedClientIp } from "@/lib/request";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const storage = getStorage();

  // Rate limit BEFORE the lookup — every check counts, valid or not. This
  // stops the endpoint from being used as a slug enumeration oracle.
  const ipHash = await getHashedClientIp(request);
  const rl = await checkRateLimit(storage, "slug-check", ipHash);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSeconds, "slug-check");
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("slug") ?? "";
  const result = validateSlug(raw);
  if (!result.ok) {
    return NextResponse.json({
      available: false,
      reason: result.reason,
      suggestions: [],
    });
  }

  const existing = await readLink(storage, result.slug);
  if (!existing) {
    return NextResponse.json({
      available: true,
      slug: result.slug,
    });
  }

  // Suggest alternatives. Suggestions are themselves validated against the
  // slug rules and reserved list, so the user can pick any of them safely.
  const suggestions = suggest(result.slug, 3);

  return NextResponse.json({
    available: false,
    reason: "taken",
    slug: result.slug,
    suggestions,
  });
}