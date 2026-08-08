"use client";

import { useMemo } from "react";
import {
  DEFAULT_EXPIRY_MINUTES,
  MAX_EXPIRY_MINUTES,
  MIN_EXPIRY_MINUTES,
  formatExpiry,
} from "@/lib/expiry";

export type ExpiryValue =
  | { kind: "preset"; preset: number }
  | { kind: "custom"; customMinutes: number }
  | { kind: "permanent" };

const PRESETS: { label: string; minutes: number }[] = [
  { label: "10 min", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "24 hours", minutes: 1440 },
  { label: "7 days", minutes: 10080 },
  { label: "30 days", minutes: 43200 },
];

interface ExpiryPickerProps {
  value: ExpiryValue;
  onChange: (value: ExpiryValue) => void;
}

export function ExpiryPicker({ value, onChange }: ExpiryPickerProps) {
  const selected =
    value.kind === "preset"
      ? `preset:${value.preset}`
      : value.kind === "custom"
        ? "custom"
        : "permanent";

  const isCustom = value.kind === "custom";

  function handleSelect(key: string) {
    if (key === "custom") {
      onChange({ kind: "custom", customMinutes: 60 });
      return;
    }
    if (key === "permanent") {
      onChange({ kind: "permanent" });
      return;
    }
    if (key.startsWith("preset:")) {
      const minutes = parseInt(key.slice("preset:".length), 10);
      onChange({ kind: "preset", preset: minutes });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.minutes}
            type="button"
            role="radio"
            aria-checked={selected === `preset:${p.minutes}`}
            onClick={() => handleSelect(`preset:${p.minutes}`)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              selected === `preset:${p.minutes}`
                ? "border-foreground bg-foreground text-background"
                : "border-input text-muted-foreground hover:border-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={selected === "custom"}
          onClick={() => handleSelect("custom")}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
            selected === "custom"
              ? "border-foreground bg-foreground text-background"
              : "border-input text-muted-foreground hover:border-foreground hover:text-foreground"
          }`}
        >
          Custom…
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={selected === "permanent"}
          onClick={() => handleSelect("permanent")}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
            selected === "permanent"
              ? "border-foreground bg-foreground text-background"
              : "border-input text-muted-foreground hover:border-foreground hover:text-foreground"
          }`}
        >
          Never
        </button>
      </div>

      {isCustom && (
        <CustomRow
          minutes={value.kind === "custom" ? value.customMinutes : 60}
          onChange={(m) => onChange({ kind: "custom", customMinutes: m })}
        />
      )}

      <Readout value={value} />
    </div>
  );
}

function CustomRow({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (m: number) => void;
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) return;
    onChange(Math.max(0, v));
  }

  const clampedUp = minutes > MAX_EXPIRY_MINUTES;
  const clampedDown = minutes < MIN_EXPIRY_MINUTES && minutes !== 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-input bg-background p-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Custom:</span>
        <input
          type="number"
          min={1}
          max={MAX_EXPIRY_MINUTES}
          value={minutes}
          onChange={handleChange}
          className="w-24 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
        />
        <span className="text-muted-foreground">minutes</span>
      </label>
      {clampedUp && (
        <p className="text-xs text-muted-foreground">
          Over the 30 day ceiling — clamped to 30 days.
        </p>
      )}
      {clampedDown && (
        <p className="text-xs text-muted-foreground">
          Below the 1 minute floor — clamped to 1 minute.
        </p>
      )}
    </div>
  );
}

function Readout({ value }: { value: ExpiryValue }) {
  const text = useMemo(() => {
    const now = new Date();
    if (value.kind === "permanent") {
      return "Permanent — stays live until you delete it.";
    }
    const minutes =
      value.kind === "preset" ? value.preset : value.customMinutes;
    const expiresAt = new Date(now.getTime() + minutes * 60_000);
    const formatted = formatExpiry(now, expiresAt);
    return `Disappears ${formatted.charAt(0).toLowerCase()}${formatted.slice(1)} — ${expiresAt.toLocaleString()}.`;
  }, [value]);

  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {text}
    </p>
  );
}

/** Re-export for the default value in the form. */
export const DEFAULT_EXPIRY: ExpiryValue = {
  kind: "preset",
  preset: DEFAULT_EXPIRY_MINUTES,
};