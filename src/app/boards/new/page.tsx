"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function NewBoardPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <main className="h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-white">
      <div className="mx-auto max-w-md h-full flex flex-col p-6">
        <div className="text-sm text-neutral-700">Redirecting…</div>
      </div>
    </main>
  );
}
