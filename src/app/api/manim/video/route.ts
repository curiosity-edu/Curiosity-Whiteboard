import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { getManimJob } from "@/lib/manim/jobs";
import { getManimRunnerMode } from "@/lib/manim/runner";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId") || "";
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const mode = getManimRunnerMode();
  if (mode === "remote") {
    const workerUrl = (process.env.MANIM_WORKER_URL || "").toString().trim();
    if (!workerUrl) {
      return NextResponse.json(
        {
          error:
            "MANIM_WORKER_URL is not set. On Vercel you must use a remote worker for Manim rendering.",
        },
        { status: 500 },
      );
    }
    return NextResponse.redirect(
      `${workerUrl.replace(/\/$/, "")}/video?jobId=${encodeURIComponent(jobId)}`,
      302,
    );
  }

  const job = getManimJob(jobId);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (!job.videoPath)
    return NextResponse.json({ error: "video not ready" }, { status: 409 });

  try {
    const info = await stat(job.videoPath);
    const stream = createReadStream(job.videoPath);

    return new NextResponse(stream as any, {
      headers: {
        "content-type": "video/mp4",
        "content-length": String(info.size),
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
