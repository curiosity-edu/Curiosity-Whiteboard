"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserAuth } from "@/context/AuthContext";

export default function MyBoardsSidebar({
  currentBoardId,
}: {
  currentBoardId?: string;
}) {
  const router = useRouter();
  const [user] = (UserAuth() as any) || [];

  const [open, setOpen] = React.useState<boolean>(() => {
    try {
      const v = localStorage.getItem("boardsOpen");
      return v ? v !== "false" : false;
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem("boardsOpen", String(open));
    } catch {}
  }, [open]);

  const [boards, setBoards] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let aborted = false;
    async function load() {
      if (!user) {
        setBoards([]);
        return;
      }
      try {
        setLoading(true);
        const rsp = await fetch("/api/boards", { cache: "no-store" });
        if (!rsp.ok) {
          if (!aborted) setBoards([]);
          return;
        }
        const j = await rsp.json();
        if (!aborted) setBoards(Array.isArray(j?.boards) ? j.boards : []);
      } catch {
        if (!aborted) setBoards([]);
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    load();
    return () => {
      aborted = true;
    };
  }, [user]);

  async function onDeleteBoard(id: string) {
    try {
      if (
        !window.confirm(
          "Are you sure you want to delete this? This action is not recoverable."
        )
      ) {
        return;
      }
      setDeletingId(id);
      const rsp = await fetch(`/api/boards/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!rsp.ok && rsp.status !== 204) {
        throw new Error(`Delete failed (${rsp.status})`);
      }
      setBoards((prev) => prev.filter((b) => b.id !== id));
      if (currentBoardId === id) {
        // Navigate to another board if available, else home
        const remaining = boards.filter((b) => b.id !== id);
        if (remaining.length > 0) router.push(`/board/${remaining[0].id}`);
        else router.push("/");
      }
    } catch (e) {
      console.error("[Boards] delete failed", e);
      alert("Failed to delete board. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  if (!user) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed left-2 top-1/2 -translate-y-1/2 z-40 h-9 w-9 flex items-center justify-center rounded-md border border-neutral-200 bg-white shadow-sm hover:bg-neutral-50"
        title="Show Boards"
        aria-label="Show Boards"
      >
        {">"}
      </button>
    );
  }

  return (
    <aside
      className="relative z-30 w-64 max-w-[320px] h-full min-h-0 border-r border-neutral-200 bg-white flex flex-col"
      aria-label="My Boards"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-neutral-50">
        <div className="text-sm font-semibold text-neutral-700 select-none">
          My Boards
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/boards/new"
            className="px-2 py-1.5 text-xs font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800"
          >
            New
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 text-xl text-neutral-500 hover:text-neutral-800"
            aria-label="Hide Boards"
            title="Hide Boards"
          >
            {"<"}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="text-xs text-neutral-500 px-2 py-2">Loading…</div>
        ) : boards.length === 0 ? (
          <div className="text-xs text-neutral-500 px-2 py-2">
            No boards yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {boards.map((b: any) => (
              <li key={b.id} className="group relative">
                <button
                  onClick={() => router.push(`/board/${b.id}`)}
                  className={`w-full text-left border border-neutral-200 rounded-md px-3 py-2 hover:bg-neutral-50 pr-10 ${
                    b.id === currentBoardId ? "bg-neutral-50" : "bg-white"
                  }`}
                >
                  <div className="font-medium text-neutral-900 truncate">
                    {b.title || "Untitled"}
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    {new Date(b.updatedAt).toLocaleString()} • {b.count} item
                    {b.count === 1 ? "" : "s"}
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteBoard(b.id);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 hidden group-hover:flex items-center justify-center rounded-md text-neutral-500 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200"
                  title="Delete board"
                  aria-label={`Delete board ${b.title || "Untitled"}`}
                  disabled={deletingId === b.id}
                >
                  {deletingId === b.id ? "…" : "🗑️"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
