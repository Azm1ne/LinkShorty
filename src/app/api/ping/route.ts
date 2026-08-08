import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage-singleton";

/**
 * Health endpoint: round-trips one value through the storage layer.
 *
 * Used during initial setup to confirm Upstash Redis is reachable from the
 * deployed app. In dev / tests, exercises the in-memory store.
 */
export async function GET() {
  const storage = getStorage();
  await storage.set("ping", "hello");
  const value = await storage.get("ping");
  return NextResponse.json({ ping: value });
}