import { CreateLinkForm } from "@/components/CreateLinkForm";

export default function HomePage() {
  return (
    <main className="flex flex-1 items-start justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <CreateLinkForm />
      </div>
    </main>
  );
}