import { headers } from "next/headers";
import { SuccessCard } from "@/components/SuccessCard";

interface SuccessPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function SuccessPage({
  params,
  searchParams,
}: SuccessPageProps) {
  const { slug } = await params;
  const { token } = await searchParams;

  // Build the base URL from the request headers in production.
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  return (
    <main className="flex flex-1 items-start justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <SuccessCard
          editToken={token ?? ""}
          shortUrl={`${baseUrl}/${slug}`}
          manageUrl={`${baseUrl}/edit/${token ?? ""}`}
        />
      </div>
    </main>
  );
}