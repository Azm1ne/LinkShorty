"use client";

import { useEffect, useRef, useState } from "react";

export type SlugAvailability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; slug: string }
  | {
      state: "unavailable";
      slug: string;
      reason: string;
      suggestions: string[];
    }
  | { state: "error"; message: string };

interface SlugInputProps {
  baseUrl: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
}

const DEBOUNCE_MS = 400;

export function SlugInput({ baseUrl, value, onChange, id = "slug" }: SlugInputProps) {
  const [availability, setAvailability] = useState<SlugAvailability>({ state: "idle" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    // Clear pending check
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (value.trim() === "") {
      setAvailability({ state: "idle" });
      return;
    }

    // Debounce
    debounceRef.current = setTimeout(async () => {
      const myId = ++requestId.current;
      setAvailability({ state: "checking" });
      try {
        const res = await fetch(`/api/links/check?slug=${encodeURIComponent(value)}`);
        if (!res.ok) {
          setAvailability({ state: "error", message: `HTTP ${res.status}` });
          return;
        }
        const data = (await res.json()) as {
          available: boolean;
          reason?: string;
          slug?: string;
          suggestions?: string[];
        };
        // Ignore stale responses
        if (myId !== requestId.current) return;
        if (data.available) {
          setAvailability({ state: "available", slug: data.slug ?? value });
        } else {
          setAvailability({
            state: "unavailable",
            slug: data.slug ?? value,
            reason: data.reason ?? "taken",
            suggestions: data.suggestions ?? [],
          });
        }
      } catch (err) {
        if (myId !== requestId.current) return;
        setAvailability({
          state: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  function pickSuggestion(slug: string) {
    onChange(slug);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        Slug
      </label>
      <div className="flex items-center rounded-md border border-input bg-background transition-colors focus-within:border-foreground">
        <span
          aria-hidden="true"
          className="select-none pl-3 font-mono text-sm text-muted-foreground"
        >
          {baseUrl}/{" "}
        </span>
        <input
          id={id}
          name={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="auto-generated if blank"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="flex-1 bg-transparent px-1 py-2 font-mono text-sm placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>

      <AvailabilityFeedback state={availability} onPick={pickSuggestion} />

      <p className="text-xs text-muted-foreground">
        4–63 chars. Lowercase letters, digits, and hyphens. Can&apos;t start or
        end with a hyphen.
      </p>
    </div>
  );
}

function AvailabilityFeedback({
  state,
  onPick,
}: {
  state: SlugAvailability;
  onPick: (slug: string) => void;
}) {
  if (state.state === "idle") {
    return (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Leave blank to auto-generate.
      </p>
    );
  }
  if (state.state === "checking") {
    return (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Checking…
      </p>
    );
  }
  if (state.state === "error") {
    return (
      <p
        className="text-xs text-destructive"
        role="alert"
        aria-live="polite"
      >
        Couldn&apos;t check: {state.message}
      </p>
    );
  }
  if (state.state === "available") {
    return (
      <p
        className="text-xs text-emerald-700 dark:text-emerald-300"
        aria-live="polite"
      >
        Available — <span className="font-mono">{state.slug}</span>
      </p>
    );
  }

  // state.state === "unavailable"
  const reasonLabel =
    state.reason === "reserved"
      ? "Reserved"
      : state.reason === "too-short"
        ? "Too short (min 4 chars)"
        : state.reason === "invalid"
          ? "Invalid format"
          : state.reason === "consecutive-hyphens"
            ? "No consecutive hyphens"
            : "Taken";

  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <p className="text-xs text-destructive">
        {reasonLabel} — <span className="font-mono">{state.slug}</span>
      </p>
      {state.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Try:</span>
          {state.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-md border border-input px-2 py-0.5 font-mono text-xs hover:border-foreground hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}