/**
 * Pure helpers for the MyBoards sidebar.
 *
 * This module is intentionally UI-free. It contains:
 * - ID and storage key generation helpers
 * - Firestore snapshot -> typed board summary conversion
 * - Firestore board operations (create, update, delete)
 *
 * Keeping this logic separate makes the sidebar component easier to reason about
 * and keeps it focused on UI + state orchestration.
 */

import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  getFirestore,
} from "firebase/firestore";

type FirestoreDb = ReturnType<typeof getFirestore>;

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
export function pendingRenameStorageKey(
  uid: string | null | undefined,
): string {
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

/**
 * Creates a new board in Firestore.
 *
 * @param db - Firestore database instance
 * @param userId - The user's UID
 * @param boardId - Unique board ID (typically generated via makeBoardId)
 * @param title - Board title (defaults to DEFAULT_BOARD_TITLE if not provided)
 * @throws Error if Firestore write fails
 *
 * Returns: void (resolves when write completes)
 *
 * Side effects:
 * - Creates a new document in users/{userId}/boards/{boardId}
 * - Initializes with empty items array and doc: null
 */
export async function createBoard(
  db: FirestoreDb,
  userId: string,
  boardId: string,
  title: string = DEFAULT_BOARD_TITLE,
): Promise<void> {
  const now = Date.now();
  await setDoc(doc(db, "users", userId, "boards", boardId), {
    id: boardId,
    title,
    createdAt: now,
    updatedAt: now,
    items: [],
    doc: null,
  });
}

/**
 * Updates a board's title in Firestore.
 *
 * @param db - Firestore database instance
 * @param userId - The user's UID
 * @param boardId - The board's ID
 * @param newTitle - The new title
 * @throws Error if Firestore update fails
 *
 * Returns: void (resolves when update completes)
 *
 * Side effects:
 * - Updates title and updatedAt fields in Firestore
 */
export async function updateBoardTitle(
  db: FirestoreDb,
  userId: string,
  boardId: string,
  newTitle: string,
): Promise<void> {
  await updateDoc(doc(db, "users", userId, "boards", boardId), {
    title: newTitle,
    updatedAt: Date.now(),
  });
}

/**
 * Deletes a board from Firestore.
 *
 * @param db - Firestore database instance
 * @param userId - The user's UID
 * @param boardId - The board's ID to delete
 * @throws Error if Firestore delete fails
 *
 * Returns: void (resolves when delete completes)
 *
 * Side effects:
 * - Removes document from users/{userId}/boards/{boardId}
 */
export async function deleteBoard(
  db: FirestoreDb,
  userId: string,
  boardId: string,
): Promise<void> {
  await deleteDoc(doc(db, "users", userId, "boards", boardId));
}

/**
 * Atomically deletes one board and creates a replacement board.
 * Used when deleting the last remaining board to avoid races.
 *
 * @param db - Firestore database instance
 * @param userId - The user's UID
 * @param oldBoardId - The board ID to delete
 * @param newBoardId - The new board ID to create (typically via makeBoardId)
 * @param newTitle - Title for the new board (defaults to DEFAULT_BOARD_TITLE)
 * @throws Error if Firestore batch operation fails
 *
 * Returns: void (resolves when batch completes)
 *
 * Preconditions:
 * - oldBoardId should be the ID of an existing board
 * - newBoardId should be unique and not yet exist
 *
 * Side effects:
 * - Atomically deletes old board and creates new board in a single batch
 * - This prevents races where old board would remain if create fails
 */
export async function deleteAndCreateBoard(
  db: FirestoreDb,
  userId: string,
  oldBoardId: string,
  newBoardId: string,
  newTitle: string = DEFAULT_BOARD_TITLE,
): Promise<void> {
  const now = Date.now();
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", userId, "boards", oldBoardId));
  batch.set(doc(db, "users", userId, "boards", newBoardId), {
    id: newBoardId,
    title: newTitle,
    createdAt: now,
    updatedAt: now,
    items: [],
    doc: null,
  });
  await batch.commit();
}
