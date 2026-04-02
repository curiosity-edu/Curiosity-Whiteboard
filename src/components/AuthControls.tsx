"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { UserAuth } from "@/context/AuthContext";

export default function AuthControls() {
  const router = useRouter();
  const pathname = usePathname();
  type AuthUser = { uid: string; displayName?: string | null };
  const rawCtx = UserAuth();
  const ctx = (Array.isArray(rawCtx) ? rawCtx : []) as unknown as [
    AuthUser | null,
    (() => Promise<void>) | undefined,
    (() => Promise<void>) | undefined,
  ];
  const user = ctx[0];
  const googleSignIn = ctx[1];
  const logOut = ctx[2];

  async function onSignIn() {
    try {
      await googleSignIn?.();
      // After successful login, go to root; it will create a new board and redirect
      if (pathname !== "/") router.push("/");
    } catch {
      // Sign-in failed
    }
  }

  async function onSignOut() {
    try {
      await logOut?.();
      // After sign-out, go to root; it will redirect to a fresh local board
      if (pathname !== "/") router.push("/");
      else router.refresh();
    } catch {
      // Sign-out failed
    }
  }

  const firstName = (user?.displayName || "").split(" ")[0] || null;

  return (
    <div className="flex items-center gap-3">
      {user ? (
        <>
          {firstName && (
            <span className="text-sm text-neutral-700">Hello {firstName}</span>
          )}
          <button
            onClick={onSignOut}
            className="px-3 py-1.5 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          onClick={onSignIn}
          className="px-3 py-1.5 text-sm font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800"
        >
          Sign in with Google
        </button>
      )}
    </div>
  );
}
