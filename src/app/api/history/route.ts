// src/app/api/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

const HISTORY_FILE = path.join(process.cwd(), "data", "solve_history.json");

type HistoryItem = { question: string; response: string; ts: number };
type Session = { id: string; title: string; createdAt: number; updatedAt: number; items: HistoryItem[] };
type HistoryFileShape = { sessions: Session[] } | HistoryItem[];

async function readHistory(): Promise<HistoryFileShape> {
  try {
    const buf = await fs.readFile(HISTORY_FILE, "utf8");
    const data = JSON.parse(buf);
    return data as HistoryFileShape;
  } catch {
    return { sessions: [] } as HistoryFileShape;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const shape = await readHistory();

  // Normalize sessions
  let sessions: Session[] = [];
  if (!Array.isArray(shape)) {
    sessions = Array.isArray((shape as any).sessions) ? (shape as any).sessions : [];
  }

  if (sessionId) {
    const s = sessions.find((x) => x.id === sessionId);
    const items = s?.items ?? [];
    return NextResponse.json({ items, title: s?.title ?? "" });
  }

  // Return sessions list metadata, newest updated first
  const list = sessions
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.items?.length ?? 0 }));
  return NextResponse.json({ sessions: list });
}
