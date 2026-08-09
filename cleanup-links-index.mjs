// cleanup-links-index.mjs
//
// One-off script: removes stale entries from the `links:index` sorted set —
// entries left behind when a link's hash expired via Redis TTL, which
// nothing currently cleans up automatically (see Issue 6 in the bug report).
//
// Usage:
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node cleanup-links-index.mjs
//
// Safe to re-run any time. Only removes entries whose `link:{slug}` hash no
// longer exists.

import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN first.");
  process.exit(1);
}

const redis = new Redis({ url, token });
const INDEX_KEY = "links:index";

const members = await redis.zrange(INDEX_KEY, 0, -1);
console.log(`Index currently has ${members.length} entries.`);

let removed = 0;
for (const slug of members) {
  const exists = await redis.exists(`link:${slug}`);
  if (!exists) {
    await redis.zrem(INDEX_KEY, slug);
    removed++;
    console.log(`Removed stale entry: ${slug}`);
  }
}

console.log(`Done. Removed ${removed} of ${members.length} entries.`);
console.log(`Index now has ${members.length - removed} entries.`);