"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { UserAuth } from "@/context/AuthContext";

export default function AuthControls() {
  const router = useRouter();
  const pathname = usePathname();
  const ctx = (UserAuth() as any) || [];
  const user = ctx[0];
  const googleSignIn = ctx[1] as (() => Promise<void>) | undefined;
  const logOut = ctx[2] as (() => Promise<void>) | undefined;

  function onSignIn() {
    try {
      // Trigger popup immediately within the click event to avoid browser blocking
      googleSignIn?.()
        .then(() => {
          if (pathname !== "/boards") router.push("/boards");
        })
        .catch((e) => {
          console.error("Sign-in failed", e);
        });
    } catch (e) {
      console.error("Sign-in failed", e);
    }
  }

  async function onSignOut() {
    try {
      await logOut?.();
      // After sign-out, keep user on current page
    } catch (e) {
      console.error("Sign-out failed", e);
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
            type="button"
            onClick={onSignOut}
            className="px-3 py-1.5 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onSignIn}
          className="px-3 py-1.5 text-sm font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800"
        >
          Sign in with Google
        </button>
      )}
    </div>
  );
}
