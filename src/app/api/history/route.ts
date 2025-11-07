// src/app/api/history/route.ts
import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

const HISTORY_FILE = path.join(process.cwd(), "data", "solve_history.json");

async function readHistory() {
  try {
    const buf = await fs.readFile(HISTORY_FILE, "utf8");
    const data = JSON.parse(buf);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

export async function GET() {
  const items = await readHistory();
  return NextResponse.json({ items });
}
