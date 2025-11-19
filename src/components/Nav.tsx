"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const pathname = usePathname();
  const isBoards = pathname === "/boards" || pathname?.startsWith("/board/");
  const isAbout = pathname?.startsWith("/about");

  const linkBase = "text-base";
  const active = "font-bold text-neutral-900";
  const inactive = "text-neutral-700 hover:text-neutral-900";

  return (
    <div className="flex items-center gap-4">
      <Link
        href="/boards"
        className={`${linkBase} ${isBoards ? active : inactive}`}
        aria-current={isBoards ? "page" : undefined}
      >
        My Boards
      </Link>
      <Link
        href="/about"
        className={`${linkBase} ${isAbout ? active : inactive}`}
        aria-current={isAbout ? "page" : undefined}
      >
        About Us
      </Link>
    </div>
  );
}
