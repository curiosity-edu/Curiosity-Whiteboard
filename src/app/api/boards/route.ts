// src/app/api/boards/route.ts
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

async function writeStore(data: StoreShape) {
  await ensureDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function toBoards(shape: StoreShape): Board[] {
  if (Array.isArray((shape as any).boards)) return (shape as any).boards as Board[];
  // migrate legacy sessions -> boards
  if (Array.isArray((shape as any).sessions)) return (shape as any).sessions as Board[];
  return [];
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET() {
  const shape = await readStore();
  const boards = toBoards(shape)
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((b) => ({ id: b.id, title: b.title, createdAt: b.createdAt, updatedAt: b.updatedAt, count: b.items?.length ?? 0 }));
  return NextResponse.json({ boards });
}

export async function POST(req: NextRequest) {
  try {
    const { title } = await req.json();
    const t = (title ?? "").toString().trim();
    if (!t) return NextResponse.json({ error: "Title is required." }, { status: 400 });

    const shape = await readStore();
    let boards = toBoards(shape);
    const now = Date.now();
    const id = makeId();
    const newBoard: Board = { id, title: t, createdAt: now, updatedAt: now, items: [] };
    boards = [newBoard, ...boards];
    try {
      await writeStore({ boards });
    } catch (e) {
      // Ignore persistence failure in serverless environments; still return the created board
      console.error("[Boards] writeStore failed during POST, continuing without persistence:", e);
    }
    return NextResponse.json({ id, title: t, createdAt: now, updatedAt: now });
  } catch (e) {
    // As a last resort, return a volatile board id so the app can proceed
    const now = Date.now();
    const id = makeId();
    return NextResponse.json({ id, title: "Untitled", createdAt: now, updatedAt: now });
  }
}
