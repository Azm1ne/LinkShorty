import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main
      role="main"
      className="flex flex-1 items-center justify-center px-6 py-24"
    >
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance">
          This link doesn&apos;t exist, or it expired.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground text-balance">
          LinkShorty doesn&apos;t distinguish the two — losing a link is losing a
          link.
        </p>
        <p className="mt-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition-colors hover:border-foreground hover:text-foreground"
          >
            Create a new short link
          </Link>
        </p>
      </div>
    </main>
  );
}