/**
 * Pure helpers for the MyBoards sidebar.
 *
 * This module is intentionally UI-free. It contains:
 * - small ID / key helpers
 * - Firestore snapshot -> typed board summary conversion
 *
 * Keeping this logic separate makes the sidebar component easier to reason about
 * and keeps it focused on UI + state orchestration.
 */

import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

export const DEFAULT_BOARD_TITLE = "Untitled Board";

export type BoardSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  count: number;
};

/**
 * Generates a locally-unique board id.
 *
 * This is used for optimistic UI updates and for creating new Firestore docs.
 */
export function makeBoardId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Key used to store the "pending rename" id after creating a new board.
 */
export function pendingRenameStorageKey(uid: string | null | undefined): string {
  const safe = uid ? String(uid) : "anon";
  return `curiosity:pendingRenameBoardId:${safe}`;
}

/**
 * Per-user rename mode key.
 */
export function renameModeStorageKey(uid: string | null | undefined): string {
  const safe = uid ? String(uid) : "anon";
  return `curiosity:renameModeBoardId:${safe}`;
}

/**
 * Converts a Firestore board doc snapshot to a minimal `BoardSummary`.
 *
 * This intentionally treats Firestore data as `unknown` and narrows at runtime.
 */
export function snapshotToBoardSummary(
  d: QueryDocumentSnapshot<DocumentData>,
): BoardSummary {
  const data: unknown = d.data();
  const maybe = (data && typeof data === "object" ? data : {}) as {
    title?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    items?: unknown;
  };

  const items = Array.isArray(maybe.items) ? maybe.items : [];

  return {
    id: d.id,
    title: typeof maybe.title === "string" ? maybe.title : "",
    createdAt: typeof maybe.createdAt === "number" ? maybe.createdAt : 0,
    updatedAt: typeof maybe.updatedAt === "number" ? maybe.updatedAt : 0,
    count: items.length,
  };
}
