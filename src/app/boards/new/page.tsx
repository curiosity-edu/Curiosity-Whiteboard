"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserAuth } from "@/context/AuthContext";
import { database } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";

export default function NewBoardPage() {
  const router = useRouter();
  const ctx = (UserAuth() as any) || [];
  const user = ctx[0];
  const [title, setTitle] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const t = title.trim();
    if (!t) {
      setError("Please enter a title.");
      return;
    }
    try {
      setSubmitting(true);
      const id = makeId();
      if (user) {
        const now = Date.now();
        await setDoc(doc(database, "users", user.uid, "boards", id), {
          id,
          title: t,
          createdAt: now,
          updatedAt: now,
          items: [],
          doc: null,
        });
      }
      router.replace(`/board/${id}`);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-white">
      <div className="mx-auto max-w-md h-full flex flex-col p-6">
        <h1 className="text-xl font-semibold text-neutral-900 mb-4">
          New Board
        </h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-neutral-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
              placeholder="e.g., Algebra Practice"
              autoFocus
            />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-2 text-sm font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Board"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
