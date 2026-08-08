import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getStorage } from "@/lib/storage-singleton";
import { readLink, findSlugByToken } from "@/lib/links";
import { EditLinkForm } from "@/components/EditLinkForm";

interface EditPageProps {
  params: Promise<{ token: string }>;
}

export default async function EditPage({ params }: EditPageProps) {
  const { token } = await params;
  if (!token) {
    notFound();
  }

  const storage = getStorage();
  const slug = await findSlugByToken(storage, token);
  if (!slug) {
    notFound();
  }

  const link = await readLink(storage, slug);
  if (!link) {
    // Token matched but the link expired or vanished between checks —
    // surface as not-found so the URL isn't a permanent foothold.
    notFound();
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  return (
    <main className="flex flex-1 items-start justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <EditLinkForm
          token={token}
          slug={link.slug}
          initialUrl={link.url}
          initialExpiresAt={link.expiresAt}
          initialHasPassword={link.hasPassword}
          shortUrl={`${baseUrl}/${link.slug}`}
          manageUrl={`${baseUrl}/edit/${token}`}
        />
      </div>
    </main>
  );
}
