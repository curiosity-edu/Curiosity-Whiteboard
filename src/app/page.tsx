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
          const snap = await getDocs(q);
          const first = snap.docs[0];
          if (first?.id) {
            if (!cancelled) router.replace(`/board/${first.id}`);
            return;
          }
          const id = makeId();
          const now = Date.now();
          await setDoc(doc(database, "users", user.uid, "boards", id), {
            id,
            title: "Untitled Board",
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
        const localId = makeId();
        if (!cancelled) router.replace(`/board/${localId}`);
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
