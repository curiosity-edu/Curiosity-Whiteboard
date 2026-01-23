import { NextRequest, NextResponse } from "next/server";
import { getManimJob } from "@/lib/manim/jobs";
import { getManimRunnerMode } from "@/lib/manim/runner";

export const runtime = "nodejs";

function json(status: number, data: unknown) {
  return NextResponse.json(data, { status });
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId") || "";
  if (!jobId) return json(400, { error: "jobId required" });

  const mode = getManimRunnerMode();
  if (mode === "remote") {
    const workerUrl = (process.env.MANIM_WORKER_URL || "").toString().trim();
    if (!workerUrl) {
      return json(500, {
        error:
          "MANIM_WORKER_URL is not set. On Vercel you must use a remote worker for Manim rendering.",
      });
    }

    try {
      const rsp = await fetch(
        `${workerUrl.replace(/\/$/, "")}/status?jobId=${encodeURIComponent(jobId)}`,
        { cache: "no-store" },
      );
      const data = await rsp.json().catch(() => null);
      return json(rsp.status, data ?? { error: "Invalid worker response" });
    } catch (e) {
      return json(502, { error: "Failed to reach MANIM worker", details: String(e) });
    }
  }

  const job = getManimJob(jobId);
  if (!job) return json(404, { error: "job not found" });

  return json(200, {
    id: job.id,
    clientId: job.clientId,
    prompt: job.prompt,
    status: job.status,
    step: job.step,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error || "",
    logs: job.logs,
    hasVideo: Boolean(job.videoPath),
  });
}
