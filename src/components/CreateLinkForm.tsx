"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExpiryPicker, type ExpiryValue } from "./ExpiryPicker";
import { SlugInput } from "./SlugInput";

interface CreateResponse {
  slug: string;
  shortUrl: string;
  editToken: string;
  expiresAt: number;
}

interface ApiError {
  error: string;
}

export function CreateLinkForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [expiry, setExpiry] = useState<ExpiryValue>({ kind: "preset", preset: 1440 });
  const [password, setPassword] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const expiresInMinutes =
        expiry.kind === "preset"
          ? expiry.preset
          : expiry.kind === "custom"
            ? expiry.customMinutes
            : 0;

      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          slug: slug || undefined,
          expiresInMinutes,
          password: passwordEnabled ? password : null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ApiError;
        const message = mapError(err.error);
        setError(message);
        toast.error(message);
        return;
      }

      const data = (await res.json()) as CreateResponse;
      router.push(`/s/${data.slug}?token=${encodeURIComponent(data.editToken)}`);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      aria-label="Create a short link"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Make a short link
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a destination. Pick a slug. Choose how long it lasts.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <label htmlFor="url" className="text-sm font-medium">
          Destination URL
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/long/path"
          autoComplete="url"
          spellCheck={false}
          className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/60"
        />
      </div>

      <SlugInput
        baseUrl={baseUrl()}
        value={slug}
        onChange={setSlug}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Expiry</legend>
        <ExpiryPicker value={expiry} onChange={setExpiry} />
      </fieldset>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={passwordEnabled}
            onChange={(e) => setPasswordEnabled(e.target.checked)}
            className="size-4 rounded border-input"
          />
          <span>Password-protect this link</span>
        </label>
        {passwordEnabled && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Anyone with this link and the password can visit"
            autoComplete="new-password"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        )}
        <p className="text-xs text-muted-foreground">
          Visitors will enter the password once and get a short-lived cookie.
          The destination URL is visible in the address bar after the gate
          opens — this stops casual resharing, not a determined person.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || !url}
        className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create short link"}
      </button>
    </form>
  );
}

function mapError(code: string): string {
  switch (code) {
    case "slug-taken":
      return "That slug is already taken. Try another.";
    case "reserved":
      return "That slug is reserved. Try another.";
    case "too-short":
      return "Slug must be at least 4 characters.";
    case "invalid":
      return "Slug must be lowercase letters, digits, and hyphens only.";
    case "consecutive-hyphens":
      return "Slug can't have consecutive hyphens.";
    case "forbidden-protocol":
      return "URL must be http(s). Other protocols aren't allowed.";
    case "self-redirect":
      return "URL can't point at this shortener.";
    case "private-host":
      return "URL can't point at a private or loopback host.";
    case "invalid-input":
      return "Please check the form and try again.";
    case "auto-generation-failed":
      return "Couldn't auto-generate a slug. Please try one manually.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function baseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.host;
  }
  // Server-rendered preview — falls back to localhost in dev. In production
  // the proxy handles redirects so this path is rarely hit there.
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/^https?:\/\//, "") ??
    "localhost:3000";
}