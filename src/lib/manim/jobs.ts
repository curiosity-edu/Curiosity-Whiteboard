export type ManimJobStatus = "queued" | "running" | "succeeded" | "failed";

export type ManimJobStep =
  | "queued"
  | "script"
  | "tts"
  | "manim_code"
  | "duration"
  | "render"
  | "stitch"
  | "done"
  | "error";

export type ManimJob = {
  id: string;
  clientId: string;
  prompt: string;
  status: ManimJobStatus;
  step: ManimJobStep;
  createdAt: number;
  updatedAt: number;
  logs: string[];
  error?: string;
  videoPath?: string;
};

type Store = {
  jobs: Map<string, ManimJob>;
  activeByClient: Map<string, string>;
};

function store(): Store {
  const g = globalThis as any;
  if (!g.__curiosityManimStore) {
    g.__curiosityManimStore = {
      jobs: new Map<string, ManimJob>(),
      activeByClient: new Map<string, string>(),
    } satisfies Store;
  }
  return g.__curiosityManimStore as Store;
}

export function createManimJob(args: { clientId: string; prompt: string }): ManimJob {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const job: ManimJob = {
    id,
    clientId: args.clientId,
    prompt: args.prompt,
    status: "queued",
    step: "queued",
    createdAt: now,
    updatedAt: now,
    logs: [],
  };
  const s = store();
  s.jobs.set(id, job);
  s.activeByClient.set(args.clientId, id);
  return job;
}

export function getManimJob(jobId: string): ManimJob | null {
  return store().jobs.get(jobId) ?? null;
}

export function getActiveJobIdForClient(clientId: string): string | null {
  return store().activeByClient.get(clientId) ?? null;
}

export function updateManimJob(jobId: string, patch: Partial<ManimJob>) {
  const s = store();
  const existing = s.jobs.get(jobId);
  if (!existing) return;
  const next: ManimJob = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  s.jobs.set(jobId, next);
}

export function appendManimJobLog(jobId: string, line: string) {
  const s = store();
  const job = s.jobs.get(jobId);
  if (!job) return;
  const nextLogs = [...job.logs, line].slice(-400);
  s.jobs.set(jobId, { ...job, logs: nextLogs, updatedAt: Date.now() });
}

export function finishManimJob(jobId: string) {
  const s = store();
  const job = s.jobs.get(jobId);
  if (!job) return;
  const active = s.activeByClient.get(job.clientId);
  if (active === jobId) s.activeByClient.delete(job.clientId);
}
