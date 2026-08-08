"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExpiryPicker, type ExpiryValue } from "./ExpiryPicker";

interface EditLinkFormProps {
  token: string;
  slug: string;
  initialUrl: string;
  initialExpiresAt: number; // 0 = permanent
  initialHasPassword: boolean;
  shortUrl: string;
  manageUrl: string;
}

interface ApiError {
  error: string;
}

interface LinkResponse {
  slug: string;
  link: {
    url: string;
    createdAt: number;
    expiresAt: number;
    hasPassword: boolean;
    previousUrl: string | null;
  };
}

function expiresAtToValue(expiresAt: number): ExpiryValue {
  if (expiresAt === 0) return { kind: "permanent" };
  const remainingMinutes = Math.max(
    1,
    Math.round((expiresAt - Date.now()) / 60_000),
  );
  return { kind: "custom", customMinutes: remainingMinutes };
}

export function EditLinkForm({
  token,
  slug,
  initialUrl,
  initialExpiresAt,
  initialHasPassword,
  shortUrl,
  manageUrl,
}: EditLinkFormProps) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [expiry, setExpiry] = useState<ExpiryValue>(() =>
    expiresAtToValue(initialExpiresAt),
  );
  // Password state — three modes: "leave" (unchanged), "clear", "set"
  const [passwordMode, setPasswordMode] = useState<"leave" | "clear" | "set">(
    "leave",
  );
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const previousUrl = useMemo(() => {
    // When the URL input differs from the initial URL, that's the "new" value;
    // what the user originally had is the previous destination.
    if (url === initialUrl) return null;
    return initialUrl;
  }, [url, initialUrl]);

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

      const body: Record<string, unknown> = {
        url,
        expiresInMinutes,
      };

      if (passwordMode === "set") {
        if (!password) {
          setError("Password can't be empty when enabling protection.");
          return;
        }
        body.password = password;
      } else if (passwordMode === "clear") {
        body.password = null;
      }

      const res = await fetch(`/api/links/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ApiError;
        const message = mapError(err.error);
        setError(message);
        toast.error(message);
        return;
      }

      const data = (await res.json()) as LinkResponse;
      toast.success("Link updated.");
      // Re-pull the latest values from the server response
      setUrl(data.link.url);
      setExpiry(expiresAtToValue(data.link.expiresAt));
      setPasswordMode("leave");
      setPassword("");
      router.refresh();
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Delete /${slug}? This cannot be undone — the short link will stop working immediately.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/links/${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ApiError;
        const message = mapError(err.error);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success("Link deleted.");
      router.push("/?deleted=1");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      aria-label="Edit short link"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Manage /{slug}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anyone with this page URL can edit or delete the link. Keep it private.
        </p>
      </header>

      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
        <strong className="font-medium">Heads up —</strong> if you lose this
        URL, the link can&apos;t be recovered. Bookmark it or copy it somewhere
        safe.
      </div>

      <ShortLinkBox shortUrl={shortUrl} manageUrl={manageUrl} />

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
          spellCheck={false}
          className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
        />
        {previousUrl && (
          <p className="text-xs text-muted-foreground">
            Previously pointed at{" "}
            <span className="font-mono break-all">{previousUrl}</span> — it
            will be overwritten when you save.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Expiry</legend>
        <ExpiryPicker value={expiry} onChange={setExpiry} />
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-md border border-input p-3">
        <legend className="px-1 text-sm font-medium">Password</legend>
        <PasswordRow
          hasPassword={initialHasPassword}
          mode={passwordMode}
          password={password}
          onModeChange={setPasswordMode}
          onPasswordChange={setPassword}
        />
      </fieldset>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-md border border-destructive/40 bg-background px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
        >
          Delete link
        </button>
      </div>

      <details className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-destructive">
          Danger zone
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-muted-foreground">
          <p>
            Deleting a link removes it from storage immediately. Anyone visiting
            /{slug} after deletion will see a 404 page.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="self-start rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
          >
            Yes, delete this link
          </button>
        </div>
      </details>
    </form>
  );
}

function PasswordRow({
  hasPassword,
  mode,
  password,
  onModeChange,
  onPasswordChange,
}: {
  hasPassword: boolean;
  mode: "leave" | "clear" | "set";
  password: string;
  onModeChange: (m: "leave" | "clear" | "set") => void;
  onPasswordChange: (p: string) => void;
}) {
  const description = hasPassword
    ? mode === "leave"
      ? "Currently protected. Save without changes to keep the existing password."
      : mode === "clear"
        ? "Will remove password protection on save."
        : "Will replace the existing password on save."
    : "Currently unprotected. Pick an option to add or skip.";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-2">
        <ModePill
          label="Leave as-is"
          active={mode === "leave"}
          onClick={() => onModeChange("leave")}
        />
        {hasPassword ? (
          <ModePill
            label="Remove password"
            active={mode === "clear"}
            onClick={() => onModeChange("clear")}
          />
        ) : null}
        <ModePill
          label={hasPassword ? "Replace password" : "Add password"}
          active={mode === "set"}
          onClick={() => onModeChange("set")}
        />
      </div>
      {mode === "set" && (
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}

function ModePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input text-muted-foreground hover:border-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ShortLinkBox({
  shortUrl,
  manageUrl,
}: {
  shortUrl: string;
  manageUrl: string;
}) {
  const [copied, setCopied] = useState<"short" | "manage" | null>(null);

  function copy(text: string, which: "short" | "manage") {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-input bg-muted/30 p-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Short link</span>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate font-mono text-sm">{shortUrl}</code>
          <button
            type="button"
            onClick={() => copy(shortUrl, "short")}
            className="rounded-md border border-input px-2 py-1 text-xs hover:border-foreground hover:text-foreground"
          >
            {copied === "short" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Manage URL (secret)</span>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate font-mono text-xs">
            {manageUrl}
          </code>
          <button
            type="button"
            onClick={() => copy(manageUrl, "manage")}
            className="rounded-md border border-input px-2 py-1 text-xs hover:border-foreground hover:text-foreground"
          >
            {copied === "manage" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function mapError(code: string): string {
  switch (code) {
    case "not-found":
      return "This manage URL is no longer valid — the link may have been deleted or expired.";
    case "invalid-input":
      return "Please check the form and try again.";
    case "forbidden-protocol":
      return "URL must be http(s). Other protocols aren't allowed.";
    case "self-redirect":
      return "URL can't point at this shortener.";
    case "private-host":
      return "URL can't point at a private or loopback host.";
    default:
      return "Something went wrong. Please try again.";
  }
}