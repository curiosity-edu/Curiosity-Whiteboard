"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserAuth } from "@/context/AuthContext";
import { database } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { TbLayoutSidebarLeftCollapseFilled } from "react-icons/tb";
import { FcAbout } from "react-icons/fc";
import { IoIosCreate } from "react-icons/io";
import { MdAnimation } from "react-icons/md";

const DEFAULT_BOARD_TITLE = "Untitled Board";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function MyBoardsSidebar({
  currentBoardId,
}: {
  currentBoardId?: string;
}) {
  const router = useRouter();
  const ctx = (UserAuth() as any) || [];
  const user = ctx[0];
  const googleSignIn = ctx[1] as (() => Promise<void>) | undefined;
  const logOut = ctx[2] as (() => Promise<void>) | undefined;

  const ensuredBoardRef = React.useRef(false);

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
  const boardsRef = React.useRef<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = React.useState<string | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [tempTitle, setTempTitle] = React.useState<string>("");
  const [profileOpen, setProfileOpen] = React.useState(false);

  React.useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);

  React.useEffect(() => {
    if (!user) {
      setBoards([]);
      ensuredBoardRef.current = false;
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(database, "users", user.uid, "boards"),
      orderBy("updatedAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const list = snap.docs.map((d) => {
          const data: any = d.data();
          const items = Array.isArray(data?.items) ? data.items : [];
          return {
            id: d.id,
            title: data?.title ?? "",
            createdAt: data?.createdAt ?? 0,
            updatedAt: data?.updatedAt ?? 0,
            count: items.length,
          };
        });

        setBoards(list);
        setLoading(false);

        // If the signed-in user has no boards (first login or deleted all),
        // auto-create a default board and navigate to it.
        if (list.length === 0 && !ensuredBoardRef.current) {
          ensuredBoardRef.current = true;
          const id = makeId();
          const now = Date.now();
          try {
            await setDoc(doc(database, "users", user.uid, "boards", id), {
              id,
              title: DEFAULT_BOARD_TITLE,
              createdAt: now,
              updatedAt: now,
              items: [],
              doc: null,
            });
            router.replace(`/board/${id}`);
          } catch (e) {
            // Allow retries if create failed
            ensuredBoardRef.current = false;
            console.error("[Boards] failed to auto-create default board", e);
          }
        }

        // If boards exist, allow auto-create to trigger again later if list becomes empty
        if (list.length > 0) ensuredBoardRef.current = false;
      },
      (err) => {
        console.error("[Boards] snapshot failed", err);
        setLoading(false);
      }
    );

    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [user, router]);

  // Close menus on outside click or Escape (including profile dropdown)
  React.useEffect(() => {
    function onDocClick() {
      setMenuOpenId(null);
      setRenamingId(null);
      setProfileOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpenId(null);
        setRenamingId(null);
        setProfileOpen(false);
      }
    }
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Close menus on outside click or Escape
  React.useEffect(() => {
    function onDocClick() {
      setMenuOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpenId(null);
        setRenamingId(null);
      }
    }
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  async function onDeleteBoard(id: string) {
    try {
      if (
        !window.confirm(
          "Are you sure you want to delete this board? This action cannot be undone."
        )
      ) {
        return;
      }
      setDeletingId(id);
      if (user) {
        const remaining = (boardsRef.current || []).filter((b) => b.id !== id);

        // If deleting the last board while signed in, delete + create in a single batch
        // to avoid races where a replacement board is created but the old one remains.
        if (currentBoardId === id && remaining.length === 0) {
          const newId = makeId();
          const now = Date.now();
          const batch = writeBatch(database);
          batch.delete(doc(database, "users", user.uid, "boards", id));
          batch.set(doc(database, "users", user.uid, "boards", newId), {
            id: newId,
            title: DEFAULT_BOARD_TITLE,
            createdAt: now,
            updatedAt: now,
            items: [],
            doc: null,
          });
          await batch.commit();
          router.push(`/board/${newId}`);
          return;
        }

        await deleteDoc(doc(database, "users", user.uid, "boards", id));

        // Navigate to another board if we just deleted the active one.
        if (currentBoardId === id) {
          if (remaining.length > 0) router.push(`/board/${remaining[0].id}`);
          else router.push("/");
        }
      } else {
        // Signed-out: local-only UI list
        setBoards((prev) => prev.filter((b) => b.id !== id));
        if (currentBoardId === id) router.push("/");
      }
    } catch (e) {
      console.error("[Boards] delete failed", e);
      alert("Failed to delete board. Please try again.");
    } finally {
      setDeletingId(null);
      setMenuOpenId(null);
    }
  }

  function startRename(b: any) {
    setRenamingId(b.id);
    setTempTitle(b.title || DEFAULT_BOARD_TITLE);
    setMenuOpenId(null);
  }

  async function commitRename(id: string) {
    const t = (tempTitle || "").trim();
    setRenamingId(null);
    if (!t) return; // ignore empty
    try {
      // Optimistic update
      setBoards((prev) =>
        prev.map((x) => (x.id === id ? { ...x, title: t } : x))
      );
      if (user) {
        await updateDoc(doc(database, "users", user.uid, "boards", id), {
          title: t,
          updatedAt: Date.now(),
        });
      }
    } catch (e) {
      console.error("[Boards] rename failed", e);
      alert("Failed to rename board. Please try again.");
    }
  }

  // Sidebar now renders for signed-out users as well, showing branding and a sign-in control at the bottom.

  if (!open) {
    return (
      <aside
        className="relative z-30 w-14 h-full min-h-0 border-r border-neutral-200 bg-white flex flex-col items-center justify-between"
        aria-label="My Boards (collapsed)"
      >
        <div className="w-full flex flex-col items-center gap-3 pt-3">
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-md hover:bg-neutral-50"
            aria-label="Expand sidebar"
            title="Expand"
          >
            <img
              src="/Asset%207.svg"
              alt="Curiosity"
              className="h-7 w-7 object-contain"
            />
          </button>
          <Link
            href="/manim"
            className="p-2 rounded-md hover:bg-neutral-50"
            aria-label="Generative Manim"
            title="Generative Manim"
          >
            <MdAnimation className="h-5 w-5" />
          </Link>
          <Link
            href="/about"
            className="p-2 rounded-md hover:bg-neutral-50"
            aria-label="About Us"
            title="About Us"
          >
            <FcAbout className="h-5 w-5" />
          </Link>
          {user ? (
            <Link
              href="/boards/new"
              className="p-2 rounded-md hover:bg-neutral-50"
              aria-label="New Board"
              title="New Board"
            >
              <IoIosCreate className="h-5 w-5" />
            </Link>
          ) : (
            <button
              onClick={async () => {
                try {
                  await googleSignIn?.();
                  router.push("/");
                } catch (e) {}
              }}
              className="p-2 rounded-md hover:bg-neutral-50"
              aria-label="Sign in to create board"
              title="Sign in"
            >
              <IoIosCreate className="h-5 w-5 opacity-60" />
            </button>
          )}
        </div>
        <div className="w-full flex flex-col items-center gap-2 pb-3">
          {user ? (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setProfileOpen((v) => !v);
                }}
                className="p-1.5 rounded-full hover:bg-neutral-50"
                aria-label="Account"
                title={user.displayName || "Account"}
              >
                <img
                  src={user.photoURL || "/avatar-placeholder.png"}
                  alt={user.displayName || "User"}
                  className="h-8 w-8 rounded-full object-cover"
                />
              </button>
              {profileOpen && (
                <div
                  role="menu"
                  className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 rounded-md border border-neutral-200 bg-white shadow-md py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-50 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      defaultChecked={(() => {
                        try {
                          const v = localStorage.getItem("addToCanvas");
                          return v ? v === "true" : false;
                        } catch {
                          return false;
                        }
                      })()}
                      onChange={(e) => {
                        try {
                          localStorage.setItem(
                            "addToCanvas",
                            String(e.target.checked)
                          );
                        } catch {}
                        try {
                          window.dispatchEvent(
                            new Event("curiosity:addToCanvasChanged")
                          );
                        } catch {}
                      }}
                    />
                    <span>Always add to Canvas</span>
                  </label>
                  <button
                    className="w-full px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                    onClick={async () => {
                      try {
                        await logOut?.();
                      } finally {
                        setProfileOpen(false);
                      }
                    }}
                    role="menuitem"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={async () => {
                try {
                  await googleSignIn?.();
                  router.push("/");
                } catch (e) {}
              }}
              className="p-2 rounded-md hover:bg-neutral-50"
              aria-label="Sign in with Google"
              title="Sign in with Google"
            >
              <img
                src="/Google__G__logo.svg.png"
                alt="Google"
                className="h-5 w-5"
              />
            </button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="relative z-30 w-64 max-w-[320px] h-full min-h-0 border-r border-neutral-200 bg-white flex flex-col"
      aria-label="My Boards"
    >
      {/* Branding & About link */}
      <div className="px-3 pt-3 pb-2 border-b border-neutral-200 bg-white">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2"
            aria-label="Curiosity Home"
          >
            <img
              src="/textred.png"
              alt="Curiosity-edu"
              className="h-9 w-auto"
            />
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="p-2 rounded-md hover:bg-neutral-50"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <TbLayoutSidebarLeftCollapseFilled className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-2">
          <Link
            href="/manim"
            className="inline-flex items-center gap-2 text-sm text-neutral-700 hover:text-neutral-900"
          >
            <MdAnimation className="h-4 w-4" />
            <span>Generative Manim</span>
          </Link>
        </div>
        <div className="mt-1">
          <Link
            href="/about"
            className="inline-flex items-center gap-2 text-sm text-neutral-700 hover:text-neutral-900"
          >
            <FcAbout className="h-4 w-4" />
            <span>About Us</span>
          </Link>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-neutral-50">
        <div className="text-sm font-semibold text-neutral-700 select-none">
          My Boards
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <Link
              href="/boards/new"
              className="inline-flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800"
            >
              <IoIosCreate className="h-4 w-4" />
              <span>New Board</span>
            </Link>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="text-xs text-neutral-500 px-2 py-2">Loading…</div>
        ) : !user ? (
          <div className="text-xs text-neutral-500 px-2 py-2">
            Sign in to create new boards.
          </div>
        ) : boards.length === 0 ? (
          <div className="text-xs text-neutral-500 px-2 py-2">
            No boards yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {boards.map((b: any) => (
              <li
                key={b.id}
                className="group relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => router.push(`/board/${b.id}`)}
                  className={`w-full text-left border border-neutral-200 rounded-md px-3 py-2 hover:bg-neutral-50 pr-10 ${
                    b.id === currentBoardId ? "bg-neutral-50" : "bg-white"
                  }`}
                >
                  {renamingId === b.id ? (
                    <input
                      autoFocus
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(b.id);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingId(null);
                        }
                      }}
                      onBlur={() => commitRename(b.id)}
                      className="w-full rounded-sm border border-blue-300 bg-blue-50 px-1 py-0.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  ) : (
                    <div className="font-medium text-neutral-900 truncate">
                      {b.title || DEFAULT_BOARD_TITLE}
                    </div>
                  )}
                  <div className="text-[11px] text-neutral-500">
                    {new Date(b.updatedAt).toLocaleString()} • {b.count} probe
                    {b.count === 1 ? "" : "s"}
                  </div>
                </button>

                {/* Kebab menu trigger */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId((prev) => (prev === b.id ? null : b.id));
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 border border-transparent"
                  title="More options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === b.id}
                >
                  ⋮
                </button>

                {menuOpenId === b.id && (
                  <div
                    role="menu"
                    className="absolute right-2 top-8 z-50 w-36 rounded-md border border-neutral-200 bg-white shadow-md py-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="w-full px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                      onClick={() => {
                        try {
                          localStorage.setItem(
                            "curiosity:openHistoryBoardId",
                            String(b.id)
                          );
                        } catch {}
                        setMenuOpenId(null);
                        router.push(`/board/${b.id}`);
                      }}
                      role="menuitem"
                    >
                      Chat History
                    </button>
                    <button
                      className="w-full px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                      onClick={() => startRename(b)}
                      role="menuitem"
                    >
                      Rename
                    </button>
                    <button
                      className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                      onClick={() => onDeleteBoard(b.id)}
                      role="menuitem"
                      disabled={deletingId === b.id}
                      aria-label={`Delete board ${
                        b.title || DEFAULT_BOARD_TITLE
                      }`}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Profile footer */}
      <div className="mt-auto border-t border-neutral-200 p-2">
        {user ? (
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setProfileOpen((v) => !v);
              }}
              className="w-full flex items-center gap-2 rounded-md px-2 py-2 hover:bg-neutral-50"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <img
                src={user.photoURL || "/avatar-placeholder.png"}
                alt={user.displayName || "User"}
                className="h-7 w-7 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm text-neutral-900">
                  {user.displayName || "User"}
                </div>
                <div className="text-[11px] text-neutral-500 truncate">
                  {user.email || ""}
                </div>
              </div>
            </button>
            {profileOpen && (
              <div
                role="menu"
                className="absolute left-2 right-2 bottom-12 z-50 rounded-md border border-neutral-200 bg-white shadow-md py-1"
                onClick={(e) => e.stopPropagation()}
              >
                <label className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-50 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    defaultChecked={(() => {
                      try {
                        const v = localStorage.getItem("addToCanvas");
                        return v ? v === "true" : false;
                      } catch {
                        return false;
                      }
                    })()}
                    onChange={(e) => {
                      try {
                        localStorage.setItem(
                          "addToCanvas",
                          String(e.target.checked)
                        );
                      } catch {}
                      try {
                        window.dispatchEvent(
                          new Event("curiosity:addToCanvasChanged")
                        );
                      } catch {}
                    }}
                  />
                  <span>Always add to Canvas</span>
                </label>
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                  onClick={async () => {
                    try {
                      await logOut?.();
                      router.push("/");
                    } finally {
                      setProfileOpen(false);
                    }
                  }}
                  role="menuitem"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={async () => {
              try {
                await googleSignIn?.();
                router.push("/");
              } catch (e) {}
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800"
          >
            <img
              src="/Google__G__logo.svg.png"
              alt="Google"
              className="h-4 w-4"
            />
            <span>Sign in with Google</span>
          </button>
        )}
      </div>
    </aside>
  );
}
