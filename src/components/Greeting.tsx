"use client";

import { UserAuth } from "@/context/AuthContext";

export default function Greeting() {
  type AuthUser = { uid: string; displayName?: string | null };
  const rawCtx = UserAuth();
  const ctx = (Array.isArray(rawCtx) ? rawCtx : []) as unknown as [
    AuthUser | null,
    unknown?,
    unknown?,
  ];
  const user = ctx[0];
  const firstName = (user?.displayName || "").split(" ")[0] || null;
  if (!firstName) return null;
  return <span className="text-sm text-neutral-700">Hello {firstName}</span>;
}
