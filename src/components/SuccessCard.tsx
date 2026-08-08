"use client";

import { toast } from "sonner";

interface SuccessCardProps {
  slug: string;
  editToken: string;
  shortUrl: string;
  manageUrl: string;
}

export function SuccessCard({
  slug,
  editToken,
  shortUrl,
  manageUrl,
}: SuccessCardProps) {
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy. Select the text and copy manually.");
    }
  }

  async function copyBoth() {
    try {
      await navigator.clipboard.writeText(
        `Short link: ${shortUrl}\nManage link: ${manageUrl}`,
      );
      toast.success("Both links copied");
    } catch {
      toast.error("Couldn't copy. Copy each link individually.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Link created</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Save the manage link now — you won&apos;t see it again.
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
          The manage link is shown once. It cannot be recovered. Losing it
          means losing control of this link.
        </p>
      </div>

      <LinkRow label="Short link" value={shortUrl} onCopy={() => copy(shortUrl, "Short link")} />

      <LinkRow
        label="Manage link"
        value={manageUrl}
        onCopy={() => copy(manageUrl, "Manage link")}
      />

      <button
        type="button"
        onClick={copyBoth}
        className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Copy both links
      </button>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">
          Show the raw manage token
        </summary>
        <p className="mt-2 font-mono break-all">{editToken}</p>
      </details>
    </div>
  );
}

function LinkRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
        <code className="flex-1 truncate font-mono text-sm">{value}</code>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md border border-input px-2 py-1 text-xs hover:border-foreground hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          Copy
        </button>
      </div>
    </div>
  );
}