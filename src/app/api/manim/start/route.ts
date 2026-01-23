import { NextRequest, NextResponse } from "next/server";
import {
  createManimJob,
  getActiveJobIdForClient,
  getManimJob,
} from "@/lib/manim/jobs";
import { startManimJob } from "@/lib/manim/runner";

export const runtime = "nodejs";

function json(status: number, data: unknown) {
  return NextResponse.json(data, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = (body?.prompt ?? "").toString().trim();
    const clientId = (body?.clientId ?? "").toString().trim();

    if (!clientId) return json(400, { error: "clientId required" });
    if (!prompt) return json(400, { error: "prompt required" });

    const activeId = getActiveJobIdForClient(clientId);
    if (activeId) {
      const active = getManimJob(activeId);
      if (active && (active.status === "queued" || active.status === "running")) {
        return json(200, { jobId: active.id, status: active.status, reused: true });
      }
    }

    const job = createManimJob({ clientId, prompt });
    const started = await startManimJob(job);

    if (!started.ok) {
      return json(500, { error: started.error, details: started.details, jobId: job.id });
    }

    return json(200, { jobId: job.id, status: job.status, reused: false });
  } catch (e) {
    return json(500, { error: String(e) });
  }
}
