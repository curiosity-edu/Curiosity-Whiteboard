import type { ManimJob } from "./jobs";

export type ManimRunnerMode = "local" | "remote";

export function getManimRunnerMode(): ManimRunnerMode {
  const v = (process.env.MANIM_RUNNER || "").toString().trim().toLowerCase();
  if (v === "local") return "local";
  if (v === "remote") return "remote";

  // If running on Vercel, we must be remote (serverless can't run manim/ffmpeg).
  const isVercel = (process.env.VERCEL || "").toString().trim() === "1";
  if (isVercel) return "remote";

  // Default: local in development.
  if (process.env.NODE_ENV === "development") return "local";

  // For non-Vercel production (including local `next start`), prefer remote only
  // if a worker is actually configured; otherwise fall back to local.
  const workerUrl = (process.env.MANIM_WORKER_URL || "").toString().trim();
  return workerUrl ? "remote" : "local";
}

export type StartManimJobResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function startManimJob(job: ManimJob): Promise<StartManimJobResult> {
  const mode = getManimRunnerMode();

  if (mode === "local") {
    const { startLocalManimJob } = await import("./startLocalJob");
    void startLocalManimJob(job);
    return { ok: true };
  }

  const workerUrl = (process.env.MANIM_WORKER_URL || "").toString().trim();
  if (!workerUrl) {
    return {
      ok: false,
      error:
        "MANIM_WORKER_URL is not set. On Vercel you must use a remote worker for Manim rendering.",
    };
  }

  try {
    const rsp = await fetch(`${workerUrl.replace(/\/$/, "")}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId: job.id,
        clientId: job.clientId,
        prompt: job.prompt,
      }),
    });

    if (!rsp.ok) {
      const txt = await rsp.text();
      return { ok: false, error: `Worker returned ${rsp.status}`, details: txt };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Failed to reach MANIM worker", details: String(e) };
  }
}
