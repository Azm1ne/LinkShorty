"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface PasswordGateFormProps {
  slug: string;
  /** Destination URL, shown after a successful unlock — the address bar will
   * display it once the proxy redirects. */
  destinationUrl: string;
}

interface GateSuccess {
  destination: string;
}

interface GateError {
  error: "invalid-password" | "rate-limited" | "missing-password" | "network";
  retryAfterSeconds?: number;
}

export function PasswordGateForm({ slug, destinationUrl }: PasswordGateFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError("Enter the password to continue.");
      return;
    }

    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch(`/api/gate/${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
      } catch {
        setError("Network error. Please try again.");
        return;
      }

      if (res.status === 200) {
        const data = (await res.json()) as GateSuccess;
        // Server-side redirect to the destination. The proxy will then see
        // the cookie and let it through.
        window.location.href = data.destination ?? destinationUrl;
        return;
      }

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as GateError;
        const seconds = data.retryAfterSeconds ?? 60;
        const minutes = Math.ceil(seconds / 60);
        setError(
          `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        );
        return;
      }

      if (res.status === 404) {
        setError("This link is no longer available.");
        return;
      }

      // 401 and other failures fall under the same generic message.
      setError("Incorrect password. Please try again.");
      // Refresh the page so the server-rendered error state is fresh, but
      // soft-navigation so we don't lose state.
      void router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      aria-label="Password-protected link"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          This link is password-protected.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the password to open{" "}
          <code className="font-mono">/{slug}</code>.
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
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        disabled={isPending}
        className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Checking…" : "Continue"}
      </button>

      <p className="text-xs text-muted-foreground">
        The destination URL will be visible in your address bar after you
        enter the password. This stops casual sharing — anyone with the
        password can also share it.
      </p>
    </form>
  );
}