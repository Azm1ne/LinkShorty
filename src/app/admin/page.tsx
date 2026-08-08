/**
 * Admin page. Server component.
 *
 * If the visitor holds a valid `ls_admin` cookie, render the list view.
 * Otherwise render the password form (client component).
 *
 * The list view itself is `AdminLinksView` — a client component that fetches
 * `/api/admin/links` and supports search and delete. We don't pre-render the
 * rows on the server because the data is mutable and can have race windows
 * with `deleteLink` from the API.
 */

import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/lib/cookie";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { AdminLinksView } from "@/components/AdminLinksView";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const store = await cookies();
  const raw = store.get(ADMIN_COOKIE_NAME)?.value;
  const grant = raw ? await verifyAdminCookie(raw) : null;

  if (!grant) {
    return (
      <main className="flex flex-1 items-start justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <AdminLoginForm />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-start justify-center px-6 py-16">
      <div className="w-full max-w-5xl">
        <AdminLinksView />
      </div>
    </main>
  );
}
