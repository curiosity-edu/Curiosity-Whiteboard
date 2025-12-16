// src/app/page.tsx
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { UserAuth } from "@/context/AuthContext";
import { database } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

const DEFAULT_BOARD_TITLE = "Untitled Board";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function Page() {
  const router = useRouter();
  const ctx = (UserAuth() as any) || [];
  const user = ctx[0];

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (user) {
          const q = query(
            collection(database, "users", user.uid, "boards"),
            orderBy("updatedAt", "desc")
          );

          // When signed in, do not fall back to anonymous/local boards.
          // Firestore reads can fail transiently during auth init; retry briefly.
          let snap: any = null;
          for (let i = 0; i < 3; i++) {
            try {
              snap = await getDocs(q);
              break;
            } catch {
              await new Promise((r) => setTimeout(r, 200));
            }
          }

          const first = snap?.docs?.[0];
          if (first?.id) {
            if (!cancelled) router.replace(`/board/${first.id}`);
            return;
          }

          // Create the default board as a fallback if none exist (or if reads failed).
          const id = makeId();
          const now = Date.now();
          await setDoc(doc(database, "users", user.uid, "boards", id), {
            id,
            title: DEFAULT_BOARD_TITLE,
            createdAt: now,
            updatedAt: now,
            items: [],
            doc: null,
          });
          if (!cancelled) router.replace(`/board/${id}`);
          return;
        }
        const localId = makeId();
        if (!cancelled) router.replace(`/board/${localId}`);
      } catch {
        // Signed-in users should never get routed to a local/ghost board.
        // If signed out, it's safe to fall back to local.
        const localId = makeId();
        if (!cancelled && !user) router.replace(`/board/${localId}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <main className="h-[calc(100vh-3.5rem)] w-full grid place-items-center bg-white" />
  );
}
