import { notFound } from "next/navigation";
import { getStorage } from "@/lib/storage-singleton";
import { readLink } from "@/lib/links";
import { PasswordGateForm } from "@/components/PasswordGateForm";

interface PasswordPageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export default async function PasswordPage({ params }: PasswordPageProps) {
  const { slug } = await params;
  if (!slug) {
    notFound();
  }

  const storage = getStorage();
  const link = await readLink(storage, slug);

  // Showing the gate for a missing/expired link would leak that the slug
  // once existed. Treat both cases as a 404 (matching the proxy behaviour).
  if (!link) {
    notFound();
  }

  // Defensive: if someone lands here on a link that isn't actually
  // password-protected (race condition, manual URL), bounce to the home
  // page rather than render a confusing gate.
  if (!link.hasPassword) {
    notFound();
  }

  return (
    <main className="flex flex-1 items-start justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <PasswordGateForm slug={slug} fallbackDestinationUrl={link.url} />
      </div>
    </main>
  );
}