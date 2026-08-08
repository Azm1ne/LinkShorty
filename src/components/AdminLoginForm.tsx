"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Single-password gate for `/admin`. Submits to `/api/admin/login` and
 * reloads on success. Errors surface inline and as a toast.
 */
export function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as {
          retryAfterSeconds?: number;
        };
        const wait = body.retryAfterSeconds ?? 60;
        const message = `Too many attempts. Try again in ${wait}s.`;
        setError(message);
        toast.error(message);
        return;
      }

      if (!res.ok) {
        setError("Wrong password.");
        toast.error("Wrong password.");
        return;
      }

      // Force a refresh so the server component re-evaluates the cookie
      // and renders the list view.
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      aria-label="Admin sign in"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the admin password to view link management.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
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
        disabled={isPending || !password}
        className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
