import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage-singleton";
import { slugExists } from "@/lib/links";
import { validateSlug } from "@/lib/slug";

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
  const exists = await slugExists(storage, result.slug);
  if (!exists) {
    return NextResponse.json({
      available: true,
      slug: result.slug,
    });
  }

  // Suggestions are filled in by T06.
  return NextResponse.json({
    available: false,
    reason: "taken",
    slug: result.slug,
    suggestions: [],
  });
}