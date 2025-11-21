// src/app/api/boards/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const STORE_FILE = path.join(process.cwd(), "data", "solve_history.json");

type HistoryItem = { question: string; response: string; ts: number };
type Board = { id: string; title: string; createdAt: number; updatedAt: number; items: HistoryItem[] };
type StoreShape = { boards: Board[] } | { sessions: any[] } | any;

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

function toBoards(shape: StoreShape): Board[] {
  if (Array.isArray((shape as any).boards)) return (shape as any).boards as Board[];
  if (Array.isArray((shape as any).sessions)) return (shape as any).sessions as Board[];
  return [];
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const shape = await readStore();
  const boards = toBoards(shape);
  const b = boards.find((x) => x.id === id);
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id: b.id, title: b.title, createdAt: b.createdAt, updatedAt: b.updatedAt, items: b.items ?? [] });
}
