# LinkShorty

A path-based, anonymous link shortener with human-readable slugs, expiring links, and password protection. Deployed on Vercel Hobby tier.

## Status

**Build complete. Ready to deploy.**

All 12 phases are done, 163 tests pass, and `next build` succeeds. See [DEPLOY.md](./DEPLOY.md) for step-by-step deployment instructions.

What's implemented:

- Next.js 16 App Router with Turbopack and Edge runtime proxy (`proxy.ts`)
- Path-based short links with custom or auto-generated human-readable slugs
- Expiring links via Upstash Redis native TTL
- Password-protected links with per-link cookie sessions
- Anonymous creation — secret manage link shown once at creation time
- Admin dashboard (single password) for listing and deleting all links
- Rate limiting across all endpoints (IP-hashed via Web Crypto)
- Slug availability check + suggestion engine
- Custom 404 page, dark mode polish, keyboard accessibility

## Locked decisions

| Decision | Choice |
|---|---|
| URL shape | Path-only — `linkshorty.vercel.app/ml-notes` |
| Accounts | None. Fully anonymous. |
| Domain | Free `vercel.app` subdomain (custom domain deferred) |
| Permanent links | Allowed |
| Creator control | Secret edit link, shown once at creation |
| Admin | Single password, can delete anything |
| Duplicate destinations | Allowed (each URL gets its own slug) |
| Deleted links | Vanish entirely, no tombstones |
| Extras | Password-protected links only. No click counter, no QR. |

See issue #16 for the full decision log.

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript
- **Storage:** Upstash Redis via Vercel Marketplace (native TTL does expiry)
- **Styling:** Tailwind CSS v4
- **Components:** shadcn/ui (button, input, label, switch, sonner)
- **Validation:** Zod
- **Hashing:** Web Crypto (`crypto.subtle`) — Edge runtime compatible
- **Hosting:** Vercel Hobby

## Build phases

The full build is broken into 12 independently testable phases. Don't skip ahead — phase 3 (`proxy.ts`) fails silently if the file is named `middleware.ts`, and you want that isolated when it does.

| # | Phase | Issue |
|---|---|---|
| 1 | Scaffold Next.js app and deploy empty to Vercel | [#1](https://github.com/Azm1ne/LinkShorty/issues/1) |
| 2 | Wire Upstash Redis via Vercel Marketplace | [#2](https://github.com/Azm1ne/LinkShorty/issues/2) |
| 3 | `proxy.ts` with one hardcoded slug redirect | [#3](https://github.com/Azm1ne/LinkShorty/issues/3) |
| 4 | `POST /api/links` with validation, slug rules, TTL | [#4](https://github.com/Azm1ne/LinkShorty/issues/4) |
| 5 | Create form UI wired to the API | [#5](https://github.com/Azm1ne/LinkShorty/issues/5) |
| 6 | Availability check + suggestion engine | [#6](https://github.com/Azm1ne/LinkShorty/issues/6) |
| 7 | Expiry picker (pills, custom row, live readout) | [#7](https://github.com/Azm1ne/LinkShorty/issues/7) |
| 8 | Success page + edit token flow | [#8](https://github.com/Azm1ne/LinkShorty/issues/8) |
| 9 | Password protection with per-link cookie | [#9](https://github.com/Azm1ne/LinkShorty/issues/9) |
| 10 | Admin page with link list and delete | [#10](https://github.com/Azm1ne/LinkShorty/issues/10) |
| 11 | Rate limiting across all endpoints | [#11](https://github.com/Azm1ne/LinkShorty/issues/11) |
| 12 | 404 page, dark mode polish, keyboard accessibility | [#12](https://github.com/Azm1ne/LinkShorty/issues/12) |

## Parked follow-ups

- [Custom domain decision](https://github.com/Azm1ne/LinkShorty/issues/13) — deferred until the build is proven
- [Safe Browsing integration](https://github.com/Azm1ne/LinkShorty/issues/14) — only if abuse becomes a real problem
- [Spec clarification](https://github.com/Azm1ne/LinkShorty/issues/15) — the trailing placeholder text in the original spec

## Environment

```
KV_REST_API_URL          auto-injected from Upstash Marketplace integration
KV_REST_API_TOKEN        auto-injected from Upstash Marketplace integration
ADMIN_PASSWORD           long and random
COOKIE_SECRET            32+ random bytes, base64
IP_SALT                  32+ random bytes, base64
NEXT_PUBLIC_BASE_URL     https://linkshorty.vercel.app
```

> `KV_REST_API_URL` and `KV_REST_API_TOKEN` come from the Upstash Marketplace integration automatically — **do NOT set them manually**.

Generate secrets: `openssl rand -base64 32`
