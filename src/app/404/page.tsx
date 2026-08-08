export default function NotFoundPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          This link doesn&apos;t exist, or it expired.
        </h1>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Both cases look the same, deliberately: distinguishing them would
          leak whether a slug was ever used.
        </p>
        <p className="mt-8">
          <a
            href="/"
            className="font-medium underline underline-offset-4 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Create a new link
          </a>
        </p>
      </div>
    </div>
  );
}