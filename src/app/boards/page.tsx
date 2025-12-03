// src/app/boards/page.tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function BoardsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ||
    (process.env.NODE_ENV !== "production" ? "http" : "https")) as string;
  const base = `${proto}://${host}`;
  try {
    const rsp = await fetch(`${base}/api/boards`, { cache: "no-store" });
    if (rsp.ok) {
      const { boards } = await rsp.json();
      if (Array.isArray(boards) && boards.length > 0) {
        return redirect(`/board/${boards[0].id}`);
      }
      // No boards: create one immediately so users land on a fresh board
      const create = await fetch(`${base}/api/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
        cache: "no-store",
      });
      if (create.ok) {
        const j = await create.json();
        if (j?.id) return redirect(`/board/${j.id}`);
      }
    }
  } catch {}
  return redirect("/boards/new");
}
