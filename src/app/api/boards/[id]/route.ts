// src/app/api/boards/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const STORE_FILE = path.join(process.cwd(), "data", "solve_history.json");

type HistoryItem = { question: string; response: string; ts: number };
type Board = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  items: HistoryItem[];
  doc?: unknown;
};
type StoreShape =
  | { boards: Board[] }
  | { sessions: Board[] }
  | Record<string, unknown>;

async function ensureDir() {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
}

async function readStore(): Promise<StoreShape> {
  try {
    await ensureDir();
    const buf = await fs.readFile(STORE_FILE, "utf8");
    return JSON.parse(buf);
  } catch {
    return { boards: [] } as StoreShape;
  }
}

async function writeStore(data: StoreShape) {
  await ensureDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function toBoards(shape: StoreShape): Board[] {
  const obj =
    shape && typeof shape === "object"
      ? (shape as Record<string, unknown>)
      : {};
  const boards = obj.boards;
  if (Array.isArray(boards)) return boards as Board[];
  const sessions = obj.sessions;
  if (Array.isArray(sessions)) return sessions as Board[];
  return [];
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const shape = await readStore();
  const boards = toBoards(shape);
  const b = boards.find((x) => x.id === id);
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    id: b.id,
    title: b.title,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    items: b.items ?? [],
  });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const shape = await readStore();
  const boards = toBoards(shape);
  const next = boards.filter((b) => b.id !== id);
  if (next.length === boards.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await writeStore({ boards: next });
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {}
  const obj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const t = (obj.title ?? "").toString().trim();
  if (!t) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  const shape = await readStore();
  const boards = toBoards(shape);
  const idx = boards.findIndex((b) => b.id === id);
  if (idx === -1)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = Date.now();
  const updated: Board = { ...boards[idx], title: t, updatedAt: now };
  const next = boards.slice();
  next[idx] = updated;
  try {
    await writeStore({ boards: next });
  } catch {
    // Failed to write store during PATCH, continuing without persistence
  }
  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
}
