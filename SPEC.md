# LinkShorty — Product Spec

## Domain glossary

These terms are used consistently throughout the spec, in issue bodies, and in code.

| Term | Meaning |
|---|---|
| **Slug** | The path portion of a short link (`ml-notes` in `linkshorty.vercel.app/ml-notes`). Lowercase, 4–63 chars, alphanumeric and hyphen. |
| **Edit token** | A 32-byte random secret shown to the creator exactly once at link creation. Holds the edit/delete power for a link. Stored only as SHA-256 hash. |
| **Manage link** | `/edit/{token}` — the URL the edit token is delivered through. Shown once on the success page. |
| **Permanent link** | A link with `expiresAt = 0`. Stays live until deleted. |
| **Expiring link** | A link with `expiresAt > 0`. Redis deletes it natively at the right moment via `EXPIREAT`. |
| **Password gate** | An optional soft-protection layer. Visitor enters a password once per link per session, gets a short-lived signed cookie. |
| **Admin** | The single-password role that can list and delete any link. Distinct from the creator of a link. |
| **Rate limit window** | The time period a counter lives for. Tiers (per spec): 1h, 24h, 15min. |
| **`ipHash`** | `SHA-256(ip + IP_SALT)`. Used for rate limiting and abuse tracing. Raw IP is never stored. |
| **Lazy reconciliation** | The admin-list pattern of `MGET`-ing slugs from `links:index` and dropping nil results, so recently-expired links stay visible until they're truly gone. |

## Problem Statement

Link shorteners fall into two camps. The big ones (bit.ly, tinyurl) require accounts, show ads, nag for sign-up, and tie your links to a vendor that may stop existing. The DIY ones (your own server, a Vercel app, a Cloudflare Worker) often ship without the security fundamentals — no rate limiting, no abuse defenses, no password protection — and become unusable within weeks of being public.

The user wants a personal link shortener that is:

- **Anonymous to use.** No accounts, no sign-up, no email. Type a URL, get a link.
- **Anonymous to host.** Free tier hosting, no paid dependencies, no recurring services.
- **Trustworthy.** Slugs read like words, not base64. Expiry is honest. Password protection actually works.
- **Resilient to abuse.** Rate limits, reserved words, and minimum slug length stop the obvious junk without needing a moderation queue.
- **Honest about its limits.** No click counter, no analytics, no QR codes. The destination URL is visible after a password gate unlocks. The manage link is shown once and cannot be recovered.

The current state is that the build specification exists, a GitHub repo is connected, and 12 build phases are tracked as issues. No code has been written.

## Solution

A Next.js 16 app deployed on Vercel Hobby, persisting everything to Upstash Redis (provisioned via the Vercel Marketplace). The whole app is path-based (`linkshorty.vercel.app/{slug}`), anonymous to use, and single-administered via one password.

The core flow:

1. Visitor lands on `/` — a form. They paste a destination URL, choose a slug (or leave it blank for auto-generation), set an expiry, optionally add a password.
2. Server creates a link in Redis with native TTL, returns a short URL and a one-time edit token.
3. Visitor copies the short URL and shares it. Anyone who hits it gets redirected, optionally through a password gate.
4. Creator keeps the edit token to manage the link later (change destination, change expiry, change password, delete). Losing the token = losing control. That's the trade for no accounts.
5. Admin can see and delete any link via a single password.

The architecture is deliberately small: one storage backend (Redis with sorted-set index), one routing layer (`proxy.ts` on the Edge), one API surface, and a 6-screen UI. Every choice that isn't load-bearing has been cut.

## User Stories

### Link creation

1. As a link creator, I want to paste a destination URL, so that I can shorten it.
2. As a link creator, I want the destination URL to be validated as http(s), so that I don't accidentally create a broken link.
3. As a link creator, I want to be told if my destination URL points at a private/loopback host, so that I can't turn the shortener into an SSRF probe.
4. As a link creator, I want to be told if my destination URL points at the shortener itself, so that I don't create a redirect loop.
5. As a link creator, I want to choose a slug, so that the link is readable and memorable.
6. As a link creator, I want the slug to be lowercased and trimmed before validation, so that `ML-Notes` works as `ml-notes`.
7. As a link creator, I want to be told live whether my slug is available, so that I don't waste a submit.
8. As a link creator, I want suggestions when my slug is taken, so that I can pick a nearby one without restarting.
9. As a link creator, I want to leave the slug blank and have one auto-generated, so that I can create links quickly.
10. As a link creator, I want auto-generated slugs to be pronounceable (`adjective-noun-adjective`), so that they read aloud and write on whiteboards cleanly.
11. As a link creator, I want my slug to be at least 4 characters, so that short, high-value slugs (`ml`, `cv`) aren't squatted.
12. As a link creator, I want reserved slugs blocked (`api`, `admin`, `edit`, etc.), so that I can't accidentally collide with app routes.
13. As a link creator, I want to choose an expiry from presets, so that I don't have to think about time.
14. As a link creator, I want the default expiry to be 24 hours, not permanent, so that the safe option is the default.
15. As a link creator, I want a "Custom" option when I'm willing to think about time, so that precise control is available without being in the way.
16. As a link creator, I want a live plain-English readout of when my link disappears, so that I never have to do date arithmetic.
17. As a link creator, I want clamping to be explained, not silent, so that I'm not surprised when my input is rewritten.
18. As a link creator, I want the "Never" option to use different copy, so that permanence reads as a deliberate choice.
19. As a link creator, I want to optionally add a password, so that I can restrict access to people I've shared the password with.
20. As a link creator, I want the form to be the homepage, so that I get to the action immediately.
21. As a link creator, I want one primary button, so that the path to submit is unambiguous.
22. As a link creator, I want feedback to use colour AND text, so that colourblind users aren't excluded.
23. As a link creator, I want the form to be keyboard-reachable end-to-end, so that I can use it without a mouse.
24. As a link creator, I want to be rate-limited if I create too many links, so that abuse tooling is deterred.

### Link success and management

25. As a link creator, I want to see my short URL on a success page, so that I can copy it.
26. As a link creator, I want to see my manage link on the success page, so that I can edit the link later.
27. As a link creator, I want both links to be copyable with one click, so that I don't have to copy each separately.
28. As a link creator, I want a "Copy both" action, so that getting the link out is one step.
29. As a link creator, I want a plain warning that the manage link is shown once, so that I don't lose it.
30. As a link creator, I want the raw edit token stored only as a hash, so that a database leak doesn't expose my links.
31. As a link creator, I want to come back to the manage link page and edit my link, so that I can fix a typo or change the destination.
32. As a link creator, I want to be able to change the destination URL, so that I can fix a moved resource without reprinting a poster.
33. As a link creator, I want to be able to change the expiry, so that I can extend or shorten the link's life.
34. As a link creator, I want to be able to add, change, or remove the password, so that I can adapt protection to context.
35. As a link creator, I want to be able to delete the link from the manage page, so that I have full control.
36. As a link creator, I want slug changes to be impossible, so that I don't accidentally orphan URLs I've already shared.
37. As a link creator, I want the previous URL stored when I repoint a link, so that admin can see a link was repointed.
38. As a link creator, I want to know that losing the manage link means losing the link, so that I make sure to save it.

### Link consumption

39. As a link visitor, I want to be redirected to the destination, so that I get where I was promised.
40. As a link visitor, I want the redirect to use 307, not 301, so that my browser doesn't cache the redirect forever.
41. As a link visitor, I want a 404 page that's identical for "never existed" and "expired", so that I can't probe for used slugs.
42. As a link visitor, I want the 404 page to be clear and not bounce me to the homepage, so that I'm not confused.
43. As a link visitor, I want a clear password gate when a link is protected, so that I know what to do.
44. As a link visitor, I want to enter a password once and not be asked again until the cookie expires, so that revisiting is friction-free.
45. As a link visitor, I want to be told honestly that the destination URL is visible after the gate, so that I understand the protection is a soft one.
46. As a link visitor, I want expired links to disappear from Redis natively, so that the system enforces expiry without a cron job.

### Admin

47. As an admin, I want to sign in with a single password, so that I can manage all links.
48. As an admin, I want the comparison to be timing-safe, so that the password isn't brute-forceable by timing side channels.
49. As an admin, I want my session cookie to be httpOnly, secure, sameSite=strict, and signed, so that it's not stealable.
50. As an admin, I want to be rate-limited on login attempts, so that the password isn't brute-forceable.
51. As an admin, I want to see all links with their slug, destination, created time, expiry, password-protected flag, and repointed flag, so that I have full visibility.
52. As an admin, I want the list to be newest-first and paginated, so that I can find recent links quickly.
53. As an admin, I want to search by slug prefix, so that I can find specific links.
54. As an admin, I want to see recently-expired links until they truly vanish from `links:index`, so that I have a small window to investigate.
55. As an admin, I want to delete any link, so that I can remove abuse.
56. As an admin, I want the deletion to be hard — `link:{slug}` and the `links:index` member both gone, so that the link is truly gone.

### Cross-cutting

57. As a user, I want the app to be fast on Edge runtime, so that redirects are globally low-latency.
58. As a user, I want dark mode from day one, so that I don't have to wait for a retrofit.
59. As a user, I want visible focus rings on every interactive element, so that keyboard navigation is obvious.
60. As a user, I want copy buttons to confirm visibly on click, so that I'm not left wondering whether the copy worked.
61. As a user, I want error messages that are explainable in plain language, so that I can fix the problem.
62. As an operator, I want IP addresses hashed at the application layer before any storage, so that a Redis leak doesn't expose visitors.
63. As an operator, I want rate limits at multiple tiers matched to the cost of the action, so that I'm not over-limiting cheap actions or under-limiting expensive ones.
64. As an operator, I want the spec to be the source of truth, so that I don't make different decisions in different places.

## Implementation Decisions

### Project skeleton

- **Framework:** Next.js 16 (App Router, Turbopack default). TypeScript strict.
- **Hosting:** Vercel Hobby. Free tier.
- **Storage:** Upstash Redis via Vercel Marketplace. `KV_REST_API_URL` and `KV_REST_API_TOKEN` are auto-injected.
- **Styling:** Tailwind CSS v4 with CSS variables for theming.
- **Components:** shadcn/ui primitives only — `button`, `input`, `label`, `switch`, `sonner`. Nothing else added unless needed.
- **Validation:** Zod, shared between client and server.
- **Hashing:** Web Crypto `crypto.subtle` for SHA-256. Works on Edge runtime.
- **Secrets:** `ADMIN_PASSWORD`, `COOKIE_SECRET`, `IP_SALT` — all env vars, generated with `openssl rand -base64 32`.

### Hot-path routing — `proxy.ts`, not `middleware.ts`

- Next.js 16 renamed `middleware.ts` to `proxy.ts`. A `middleware.ts` file would silently do nothing — no error, no warning, just 404s on every short link. The file is named `proxy.ts` at the project root.
- `proxy.ts` runs on Edge.
- Skip rules: paths starting with `/api`, `/_next`, `/admin`, `/edit`, `/s`, or paths containing a `.` (static files).
- Lookup order: `HGETALL link:{slug}` → if nil, rewrite to 404 page (NOT redirect to `/`); if `passwordHash` set, rewrite to `/{slug}/password`; otherwise `NextResponse.redirect(url, 307)`.
- 307 over 301 is a deliberate choice — 301 is cached permanently by browsers, so an expired or deleted link would still redirect to the old destination from local cache for months.

### Data model — Redis hash + sorted set + rate counters

```
link:{slug}             hash        the link itself
links:index             zset        slug → createdAt (unix ms), for admin list
rate:{type}:{ipHash}    counter     rate limit buckets, with TTL via EXPIRE ... NX
```

`link:{slug}` fields: `url`, `createdAt`, `expiresAt` (0 = permanent), `editTokenHash`, `passwordHash`, `createdByIp`, `previousUrl` (set when destination is repointed).

`EXPIREAT link:{slug} {seconds}` is set when `expiresAt > 0`. Redis deletes the key itself. No cron job, no sweeper.

`links:index` is the only way to list links without a full `KEYS *` scan. Admin pagination uses `ZREVRANGE`. Lazy reconciliation on list load: `MGET` the slugs, drop nils (recently-expired links stay visible until they vanish).

`rate:{type}:{ipHash}` counters use `INCR` then `EXPIRE ... NX` — the `NX` flag is mandatory. Without it, every request resets the window and the limit never fires.

### API surface

```
POST /api/links              create
GET  /api/links/check        slug availability
PATCH /api/links/[token]     edit via edit token
DELETE /api/links/[token]    delete via edit token
GET /api/admin/links         list (admin-only)
DELETE /api/admin/links      delete any link (admin-only)
```

Errors use standard HTTP codes: `400` invalid input, `409` slug taken, `422` reserved slug, `429` rate limited (with `Retry-After`).

### URL validation rules

- Must parse as a URL and be `http:` or `https:`.
- Reject `javascript:`, `data:`, `file:`, `vbscript:` — `javascript:` is a stored XSS via open redirect.
- Reject URLs pointing at the shortener's own domain — redirect loops.
- Reject private and loopback hosts (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.x`) — otherwise the shortener becomes an SSRF probe.

### Slug rules

- `^[a-z0-9]([a-z0-9-]{2,61})[a-z0-9]$` — 4–63 chars, lowercase alphanumeric and hyphens, no leading/trailing hyphen, no consecutive hyphens.
- Input is lowercased and trimmed before validation.
- Reserved list: `api  admin  login  logout  signup  register  dashboard  settings  edit  new  create  delete  s  static  public  assets  favicon  about  help  support  terms  privacy  contact  status  health  robots  sitemap  manifest  _next  www  mail  ftp  cdn  app`.
- All-slugs-under-4-chars are already covered by the length rule.

### Suggestion algorithm — when slug is taken

1. Try `{slug}-one`, `{slug}-two`, `{slug}-three`.
2. Try `{slug}-2026`.
3. Fall back to a random ordinal from a curated list.

Ordinal words read better than digits for slugs spoken aloud or written on whiteboards. Year is a sensible fallback.

### Auto-generated slugs

Two curated wordlists, ~200 adjectives, ~200 nouns, produces `adjective-noun-adjective` (~8M combos). Lists are hand-curated against unfortunate pairings — random dictionary words will eventually produce `cruel-ladybug-brave` or worse.

### Expiry model

- Client sends `expiresInMinutes: number` (0 = permanent).
- Server clamps to `[1, 43200]` minutes. Client validation is courtesy; server is authority.
- `expiresAt = 0` → no `EXPIREAT`, link lives forever.
- `expiresAt > 0` → `EXPIREAT link:{slug} {unix-seconds}`.
- Default on the create form is 24 hours (1440 minutes), not "Never".

### Password protection

- Hash = `SHA-256(password + slug)`. Slug acts as salt — identical passwords on different links produce different hashes.
- Successful submission sets a short-lived signed cookie scoped to that slug.
- Cookie lets the visitor re-enter without re-entering the password until it or the link expires.
- Rate limit: 10 attempts per IP per slug per hour. Without this, the gate is decorative.
- The destination URL is visible in the address bar after the gate unlocks. The UI is honest about this.

### Edit token

- 32-byte random token via `crypto.getRandomValues`.
- Stored as `SHA-256(token)` in `link:{slug}.editTokenHash`.
- Raw token shown exactly once on the success page — never recoverable.
- `/edit/[token]` looks up by hash, returns 404 on miss.
- Allows: change destination, change expiry, change password (add/remove/update).
- Does NOT allow: change slug (would orphan shared URLs).
- Delete is included in the edit page.

### Admin

- `ADMIN_PASSWORD` env var. Single password, single role.
- Login at `/admin` uses timing-safe comparison.
- Session cookie: httpOnly, secure, sameSite=strict, signed, 7-day lifetime.
- Rate limit: 5 attempts per IP per 15 minutes.
- List view: slug, destination (truncated), created, expiry (or "permanent"), password-protected flag, repointed flag, delete button.
- Newest-first, paginated 50 at a time via `ZREVRANGE`.
- Search filters by slug prefix.
- Deletes remove both `link:{slug}` and the `links:index` member. No tombstone.

### Rate limits — tiered by cost

| Type | Limit |
|---|---|
| Expiring links | 20 per IP per hour |
| Permanent links | 5 per IP per day |
| Failed slug checks | 60 per IP per hour |
| Password attempts | 10 per IP per slug per hour |
| Admin login | 5 per IP per 15 minutes |

All rates are enforced via `rate:{type}:{ipHash}` counters with `EXPIRE ... NX`.

### Privacy

- Store `SHA-256(ip + IP_SALT)` only. Raw IP never stored.
- `IP_SALT` is a random env var, regenerated on secret rotation.
- A leak exposes per-link hashed IP, not raw IP — still useful for abuse tracing, not useful for visitor identification.

### UI

- Single column, centred, max-width 560px.
- One sans-serif family, two weights. Slugs/URLs in monospace (read as identifiers).
- Slug field renders the domain prefix as inert grey text inside the input frame, so the URL reads as one continuous thing.
- Availability feedback uses colour AND text, never colour alone.
- Every interactive element keyboard-reachable, with visible focus rings.
- Copy buttons confirm visibly on click (Sonner toasts).
- Dark mode from day one via CSS variables.
- Six screens: Create, Success, Password Gate, 404, Edit, Admin.

### Build order — 12 phases, each independently testable

The order is deliberate. Phase 3 (`proxy.ts`) is where most shorteners break — Next.js 16 renamed the file, and naming it `middleware.ts` silently does nothing. Isolated early so the failure mode is obvious.

1. Scaffold Next.js, deploy empty to Vercel.
2. Provision Upstash Redis, prove round-trip in production.
3. `proxy.ts` with one hardcoded slug.
4. `POST /api/links` with validation, slug rules, TTL — test with `curl` before any UI.
5. Create form UI.
6. Availability check + suggestions.
7. Expiry picker.
8. Success page + edit token flow.
9. Password protection.
10. Admin page.
11. Rate limiting across all endpoints.
12. 404 page, dark mode, keyboard accessibility.

### Decisions deferred (parked)

- **Custom domain.** Free `vercel.app` subdomain used. Decision to buy a short domain deferred until the build is proven.
- **Safe Browsing API.** Not integrated at launch. Out of scope by design — adds key, quota, and latency to every create. Single function to add later if abuse becomes real.
- **Duplicate destinations.** Always create a new slug for the same URL. No lookup on the URL side.
- **Tombstones for deleted links.** Vanish entirely. No audit trail.

## Testing Decisions

### The highest seam is the live deployment

The natural test surface for this app is the live URL. The whole product is a small set of HTTP routes and a storage layer. Integration tests against the real Vercel deployment exercise the full stack: Edge runtime, Upstash, validation, cookies, redirects.

Every phase in the build order has a "Done when" check that runs against the live URL. The 12 phase issues are the smoke test suite.

### End-to-end smoke tests

Each phase has explicit acceptance criteria written in the issue body. Examples:

- Phase 1: the default Next.js page renders at the Vercel URL.
- Phase 2: `curl https://linkshorty.vercel.app/api/ping` returns the value that was just set, after deploying.
- Phase 3: `linkshorty.vercel.app/test` redirects to `example.com` in an incognito window; `linkshorty.vercel.app/does-not-exist` returns 404.
- Phase 4: `curl` creates a link, the slug appears in `links:index`, and the `link:{slug}` key self-deletes at the right time.
- Phase 9: a password-protected link requires the password once, then lets the visitor back in via cookie. Wrong password 11 times in an hour = 429.
- Phase 10: admin signs in, browses, searches by prefix, deletes a link, sees it gone from both the page and the index.

### Unit tests — only where units are sharp

The codebase has very few units worth testing in isolation:

- **Slug validation** — pure function, easy to test boundary cases (length 3, length 4, length 63, length 64, leading/trailing hyphen, consecutive hyphens, mixed case, reserved words).
- **Suggestion algorithm** — pure function, test the fallback chain.
- **Wordlist helpers** — sanity check that auto-generated slugs are pronounceable (validates length and character set).

Cookie signing, password hashing, rate-limit counters, and routing rewrites are not units worth testing in isolation — they are integration territory, exercised by the live-URL smoke tests.

### What makes a good test here

- Tests external behavior (the URL redirected, the API returned 201, the value persisted), not implementation details (which Redis client was used, which cookie name was chosen).
- Tests are reproducible from a fresh `curl` with no setup beyond the deployed URL.
- Tests don't depend on the state of other tests — each test creates its own link or uses a slug that survives its own run.

### Prior art

There is no prior art in this codebase — it's greenfield. The smoke-test pattern (curl-driven, deploy-bound) is the convention being adopted and should be preserved if the project grows.

## Out of Scope

- **Accounts, sign-up, sign-in.** Fully anonymous creation. The trade-off (losing the edit token = losing control) is committed.
- **Custom domain.** Deferred until the build is proven.
- **Click counter / analytics.** Not tracked at creation, not stored, not displayed.
- **QR code generation.** Not in the create flow.
- **Link preview page.** Not implemented — visitors are sent directly to the destination.
- **Safe Browsing API integration.** Out of scope at launch. Single function to add later if needed.
- **Tombstones / audit log for deleted links.** Deleted links vanish entirely.
- **Duplicate destination dedup.** Each URL gets its own slug if the user wants one.
- **Email or any recovery channel.** There's no email. Lost tokens are lost.
- **Self-hosted deployments.** The build is Vercel-specific by design (Upstash via Vercel Marketplace, native Vercel env injection).
- **Mobile apps.** Web-only.
- **i18n.** English-only UI for v1.

## Further Notes

### The two things that will bite during the build

1. **`proxy.ts` not `middleware.ts`.** Every shortener tutorial online still says `middleware.ts`. On Next.js 16, a `middleware.ts` file does nothing at all — no error, no warning, just 404s on every short link. The file is named `proxy.ts` at the project root. Phase 3 exists specifically to surface this if it happens.

2. **Vercel KV no longer exists.** It was folded into Upstash Redis in December 2024. Provision Redis from the Vercel Marketplace, which auto-injects the env vars. Free tier is roughly 500K commands per month — a personal shortener will not come close.

### Privacy stance

The IP-hashing design (`SHA-256(ip + IP_SALT)`) is a deliberate choice. It still works for rate limiting and abuse tracing, but a Redis leak doesn't expose visitor IPs. The `IP_SALT` should be treated as a secret and rotated if compromised.

### The honest trade-offs

This project makes several "no" decisions that are the point:

- No click counter → less feature surface, less data to protect.
- No preview page → less attack surface, less to maintain.
- No accounts → lower friction, but losing the edit token loses control.
- Password gate is honest-soft → stops casual resharing, not a determined attacker. The UI says so.

These are flagged on the success page and the password gate UI so users aren't surprised by the limits. A tool that hides its limits is a tool that disappoints.

### The spec is the source of truth

This document, the spec the user wrote, and the 12 phase issues in the tracker are the three reference points. Drift between them is a bug. If a decision changes, all three update.
