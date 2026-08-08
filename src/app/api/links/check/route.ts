import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage-singleton";
import { readLink } from "@/lib/links";
import { validateSlug } from "@/lib/slug";
import { suggest } from "@/lib/suggestions";

export async function GET(request: Request) {
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

  const storage = getStorage();
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