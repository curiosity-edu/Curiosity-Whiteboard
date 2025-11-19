// src/app/boards/page.tsx
import Link from "next/link";
import { headers } from "next/headers";

async function fetchBoards() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = (h.get("x-forwarded-proto") || (process.env.NODE_ENV !== "production" ? "http" : "https")) as string;
  const base = `${proto}://${host}`;
  const rsp = await fetch(`${base}/api/boards`, { cache: "no-store" });
  if (!rsp.ok) return { boards: [] };
  return rsp.json();
}

export default async function BoardsPage() {
  const { boards } = await fetchBoards();
  return (
    <main className="h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-white">
      <div className="mx-auto max-w-4xl h-full flex flex-col p-4 gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-neutral-900">My Boards</h1>
          <form action="/boards/new" method="get">
            <button className="px-3 py-2 text-sm font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800">New Board</button>
          </form>
        </div>
        <div className="flex-1 overflow-auto">
          {(!boards || boards.length === 0) ? (
            <div className="text-sm text-neutral-500">No boards yet. Create your first board.</div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {boards.map((b: any) => (
                <li key={b.id}>
                  <Link href={`/board/${b.id}`} className="block border border-neutral-200 rounded-md p-3 hover:bg-neutral-50">
                    <div className="font-medium text-neutral-900 truncate">{b.title || "Untitled"}</div>
                    <div className="text-xs text-neutral-500">{new Date(b.updatedAt).toLocaleString()} • {b.count} item{b.count === 1 ? "" : "s"}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
