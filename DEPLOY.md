# Deploying LinkShorty to Vercel

This guide walks you through deploying LinkShorty to Vercel from scratch. The repo already contains the code; this document is for the operator setting up the deployment.

## Prerequisites

- A Vercel account (Hobby tier is fine)
- The [Vercel CLI](https://vercel.com/docs/cli) installed (`npm i -g vercel`) — optional, you can also use the GitHub integration
- A GitHub account with this repo pushed

## One-time setup

### Provision Upstash Redis via Vercel Marketplace

1. In the Vercel dashboard, click **New Project** → import the GitHub repo.
2. Before the first deploy, go to **Project → Storage → Create Database → Upstash → Continue with Vercel Marketplace**.
3. Pick a region close to your visitors. Hobby tier includes free Upstash usage.
4. The env vars `KV_REST_API_URL` and `KV_REST_API_TOKEN` are auto-injected into the project by the integration. **Do NOT add them manually** — Vercel Marketplace binds them automatically. If you don't see them in **Project Settings → Environment Variables** after creating the database, re-link from the Storage tab.

### Set secrets

Go to **Project → Settings → Environment Variables** and add the following for **Production** (and Preview if you want):

| Name | Value | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | `openssl rand -base64 24` | The admin sign-in password. **Lose this = lose admin access (no recovery).** |
| `COOKIE_SECRET` | `openssl rand -base64 32` | HMAC key for signed cookies (gate + admin). Rotating invalidates all existing sessions. |
| `IP_SALT` | `openssl rand -base64 32` | Salt for hashing client IPs. Rotating resets all rate-limit counters. |
| `NEXT_PUBLIC_BASE_URL` | `https://your-app.vercel.app` | **Required.** Used by the proxy and the API to detect self-redirects. Must match the deployment domain exactly (no trailing slash). |

> `KV_REST_API_URL` and `KV_REST_API_TOKEN` come from the Upstash integration — do not set them manually.

## Deploy

1. Push to `main` (or whatever branch you set as the Production Branch in Vercel).
2. Vercel builds with `next build` automatically. The first build takes ~2 minutes.
3. After the build succeeds, visit `https://your-app.vercel.app/` — the create form should render.

## Smoke test after deploy

Run through these checks to confirm everything works:

1. **Create a link.** Paste `https://example.com`, leave the slug blank, leave expiry default, submit. You should land on a success page with a short URL and a manage link.
2. **Visit the short URL.** You should be redirected to `https://example.com`.
3. **Visit the manage link.** Change the expiry to a custom value, save. You should see the new expiry reflected.
4. **Password gate.** Create another link with a password. Visit the short URL — you should see the gate form. Enter the password — you should land on the destination.
5. **Admin.** Visit `/admin`. Sign in with `ADMIN_PASSWORD`. You should see your links. Delete one — it should vanish from the list.
6. **404.** Visit `https://your-app.vercel.app/nonexistent-slug` — you should see the 404 page.

If any of these fail, check:

- Vercel Function logs (Logs tab in dashboard)
- That `KV_REST_API_URL` and `KV_REST_API_TOKEN` are present in env vars (they auto-inject from the Upstash integration)
- That `NEXT_PUBLIC_BASE_URL` matches your domain

## Post-deploy

- Set a strong `ADMIN_PASSWORD` — anyone with it can delete any link.
- Bookmark `https://your-app.vercel.app/admin`.
- Don't share the manage link publicly — it holds edit/delete power for that link. The manage link is shown **once** at creation time; if you lose it, the link is unmanaged.
