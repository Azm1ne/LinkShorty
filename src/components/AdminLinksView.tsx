"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mapApiError } from "@/lib/error-messages";

/**
 * Admin link management view. Lists links newest-first, supports slug
 * prefix search and delete. Delete uses `window.confirm` for a quick
 * safety check; the real protection is the signed admin cookie.
 */

interface LinkRecord {
  slug: string;
  url: string;
  createdAt: number;
  expiresAt: number;
  hasPassword: boolean;
  previousUrl: string | null;
}

interface ListResponse {
  links: LinkRecord[];
  total: number;
  offset: number;
  limit: number;
}

const PAGE_SIZE = 50;

export function AdminLinksView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (searchTerm: string) => {
      setError(null);
      startTransition(async () => {
        const params = new URLSearchParams({
          offset: "0",
          limit: String(PAGE_SIZE),
        });
        if (searchTerm) params.set("search", searchTerm);
        const res = await fetch(`/api/admin/links?${params.toString()}`);
        if (!res.ok) {
          setError("Couldn't load links.");
          toast.error("Couldn't load links.");
          return;
        }
        const body = (await res.json()) as ListResponse;
        setData(body);
      });
    },
    [],
  );

  useEffect(() => {
    load(activeSearch);
  }, [activeSearch, load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setActiveSearch(search.trim());
  }

  function handleDelete(slug: string) {
    if (!window.confirm(`Delete link "${slug}"? This cannot be undone.`)) {
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = mapApiError(body, "Couldn't delete link.");
        toast.error(message);
        return;
      }
      toast.success(`Deleted ${slug}.`);
      load(activeSearch);
    });
  }

  function handleSignOut() {
    // The cookie is set via the login route; we don't have a logout endpoint
    // yet. Clearing the cookie client-side is enough for the prototype.
    document.cookie = "ls_admin=; Path=/; Max-Age=0; SameSite=Strict";
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Links</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} link${data.total === 1 ? "" : "s"}` : "Loading…"}
            {activeSearch ? ` matching "${activeSearch}"` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Sign out
        </button>
      </header>

      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by slug prefix…"
          aria-label="Search links by slug prefix"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Search
        </button>
        {activeSearch && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setActiveSearch("");
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Destination</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data?.links.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No links yet.
                </td>
              </tr>
            )}
            {data?.links.map((link) => (
              <tr key={link.slug} className="align-top">
                <td className="px-3 py-2 font-mono text-xs">
                  <a
                    href={`/${link.slug}`}
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:opacity-80"
                  >
                    {link.slug}
                  </a>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <span title={link.url}>{truncate(link.url, 50)}</span>
                  {link.previousUrl && (
                    <div
                      className="mt-1 text-[10px] text-muted-foreground"
                      title={`Previous: ${link.previousUrl}`}
                    >
                      ← prev: {truncate(link.previousUrl, 40)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {formatDate(link.createdAt)}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {link.expiresAt === 0 ? (
                    <span className="text-muted-foreground">permanent</span>
                  ) : (
                    formatDate(link.expiresAt)
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    {link.hasPassword && (
                      <span
                        title="Password-protected"
                        aria-label="Password-protected"
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        pw
                      </span>
                    )}
                    {link.previousUrl && (
                      <span
                        title="Repointed"
                        aria-label="Repointed"
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        repointed
                      </span>
                    )}
                    {!link.hasPassword && !link.previousUrl && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleDelete(link.slug)}
                    disabled={isPending}
                    aria-label={`Delete ${link.slug}`}
                    className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  // ISO date in the user's local timezone, but compact.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
