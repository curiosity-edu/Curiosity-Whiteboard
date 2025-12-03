// src/app/page.tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";

async function createBoard() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ||
    (process.env.NODE_ENV !== "production" ? "http" : "https")) as string;
  const base = `${proto}://${host}`;
  const rsp = await fetch(`${base}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Untitled" }),
    cache: "no-store",
  });
  if (!rsp.ok) return null;
  return rsp.json();
}

export default async function Page() {
  const created = await createBoard();
  const id = created?.id as string | undefined;
  if (id) redirect(`/board/${id}`);
  // If board creation fails, render a simple retry UI to avoid redirect loops
  return (
    <main className="h-[calc(100vh-3.5rem)] w-full grid place-items-center bg-white">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-neutral-900">
          Couldn’t create a new board
        </h1>
        <p className="text-sm text-neutral-600 mt-1">Please try again.</p>
        <form action="/" method="get" className="mt-3">
          <button className="px-3 py-2 text-sm font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800">
            Try Again
          </button>
        </form>
      </div>
    </main>
  );
}
