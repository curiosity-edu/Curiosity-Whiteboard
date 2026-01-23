"use client";

import Link from "next/link";
import * as React from "react";

type ManimStatus = {
  id: string;
  clientId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed";
  step: string;
  createdAt: number;
  updatedAt: number;
  error: string;
  logs: string[];
  hasVideo: boolean;
};

function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem("curiosity:manimClientId");
    if (existing) return existing;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("curiosity:manimClientId", id);
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export default function ManimPage() {
  const [prompt, setPrompt] = React.useState("");
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<ManimStatus | null>(null);
  const [error, setError] = React.useState<string>("");
  const [isStarting, setIsStarting] = React.useState(false);

  const isGenerating =
    isStarting ||
    (Boolean(jobId) &&
      (!status || status.status === "queued" || status.status === "running"));

  const videoUrl = React.useMemo(() => {
    if (!jobId) return "";
    if (!status?.hasVideo) return "";
    return `/api/manim/video?jobId=${encodeURIComponent(jobId)}`;
  }, [jobId, status?.hasVideo]);

  React.useEffect(() => {
    if (!jobId) return;
    if (status?.status === "succeeded" || status?.status === "failed") return;

    let cancelled = false;
    const tick = async () => {
      try {
        const rsp = await fetch(
          `/api/manim/status?jobId=${encodeURIComponent(jobId)}`,
        );
        const data = (await rsp.json()) as any;
        if (!rsp.ok) throw new Error(data?.error || `status ${rsp.status}`);
        if (!cancelled) setStatus(data as ManimStatus);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    void tick();
    const id = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId, status?.status]);

  async function start() {
    setError("");
    const p = prompt.trim();
    if (!p) {
      setError("Please enter a prompt.");
      return;
    }

    setIsStarting(true);
    try {
      const clientId = getOrCreateClientId();
      const rsp = await fetch("/api/manim/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: p, clientId }),
      });
      const data = (await rsp.json()) as any;
      if (!rsp.ok) throw new Error(data?.error || `start ${rsp.status}`);

      const id = String(data.jobId || "");
      setJobId(id);
      setStatus({
        id,
        clientId,
        prompt: p,
        status: "queued",
        step: "starting",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        error: "",
        logs: ["Starting job…"],
        hasVideo: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="bg-white h-screen w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 text-neutral-900 bg-white">
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
            aria-label="Go back to whiteboard"
          >
            <span>←</span>
            <span>Go back to whiteboard</span>
          </Link>
        </div>

        <h1 className="text-2xl font-semibold mb-4">Generative Manim</h1>

        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Type a prompt to generate a relevant math animation."
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={start}
                disabled={isGenerating}
                className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
              >
                {isGenerating ? "Generating…" : "Generate Manim"}
              </button>
              {jobId ? (
                <div className="text-xs text-neutral-500">Job: {jobId}</div>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="text-sm text-red-700 border border-red-200 bg-red-50 rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}

          {status ? (
            <div className="rounded-md border border-neutral-200 bg-white">
              <div className="px-3 py-2 border-b border-neutral-200 flex items-center justify-between">
                <div className="text-sm font-medium text-neutral-800">
                  Status: {status.status} ({status.step})
                </div>
                {status.status === "failed" && status.error ? (
                  <div className="text-xs text-red-700">{status.error}</div>
                ) : null}
              </div>
              <div className="px-3 py-2">
                <div className="text-xs text-neutral-500 mb-2">Logs</div>
                <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-y-auto bg-neutral-50 border border-neutral-200 rounded p-2">
                  {(status.logs || []).join("\n")}
                </pre>
              </div>
            </div>
          ) : null}

          {status?.status === "succeeded" && status?.hasVideo && videoUrl ? (
            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="text-sm font-medium text-neutral-800 mb-2">
                Preview
              </div>
              <video
                key={videoUrl}
                controls
                className="w-full rounded-md border border-neutral-200"
                src={videoUrl}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
