import OpenAI from "openai";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

import {
  appendManimJobLog,
  finishManimJob,
  updateManimJob,
  type ManimJob,
} from "./jobs";

function sanitizeForFilename(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseNarViz(script: string) {
  const narMatches = [...script.matchAll(/<nar>([\s\S]*?)<nar>/g)].map((m) =>
    (m[1] || "").trim(),
  );
  const vizMatches = [...script.matchAll(/<viz>([\s\S]*?)<viz>/g)].map((m) =>
    (m[1] || "").trim(),
  );
  return {
    nar: narMatches.map((x) => x.replace(/<.*?>/g, "").trim()).filter(Boolean),
    viz: vizMatches.map((x) => x.replace(/<.*?>/g, "").trim()).filter(Boolean),
  };
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function writeFile(p: string, content: string | Buffer) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content);
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else out.push(full);
  }
  return out;
}

function runCmd(
  jobId: string,
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    appendManimJobLog(jobId, `$ ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: process.env,
    });

    child.stdout.on("data", (d) => {
      appendManimJobLog(jobId, String(d).trimEnd());
    });
    child.stderr.on("data", (d) => {
      appendManimJobLog(jobId, String(d).trimEnd());
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function extractPythonFromMarkdown(text: string) {
  const matches = [...text.matchAll(/```python([\s\S]*?)```/g)].map((m) =>
    (m[1] || "").trim(),
  );
  if (matches.length > 0) return matches[matches.length - 1];

  const generic = [...text.matchAll(/```([\s\S]*?)```/g)].map((m) =>
    (m[1] || "").trim(),
  );
  if (generic.length > 0) return generic[generic.length - 1];

  return text.trim();
}

function forceClassName(code: string, className: string) {
  // Replace only the first class definition.
  return code.replace(/class\s+[A-Za-z_][A-Za-z0-9_]*/m, `class ${className}`);
}

function setDurationInManimScript(code: string, totalDuration: number) {
  const lines = code.split(/\r?\n/);
  const playCount = lines.filter((l) => l.includes("self.play")).length;
  if (playCount <= 0) return code;

  const out: string[] = [];
  for (const line of lines) {
    if (line.includes("def construct")) {
      out.push(line);
      const indent = (line.match(/^(\s*)/)?.[1] ?? "");
      out.push(`${indent}    runtime = ${totalDuration}`);
      out.push(`${indent}    play = ${playCount}`);
      out.push(`${indent}    dur = runtime / play`);
      continue;
    }

    if (line.includes("self.play")) {
      const replaced = line.replace(
        /(self\.play\(.*?)(\))\s*$/,
        "$1, run_time=dur$2",
      );
      out.push(replaced);
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

async function ffprobeDurationSeconds(jobId: string, filePath: string): Promise<number> {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", args, { env: process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code !== 0) {
        appendManimJobLog(jobId, err.trimEnd());
        reject(new Error(`ffprobe exited with code ${code}`));
        return;
      }
      const v = Number.parseFloat(out.trim());
      if (!Number.isFinite(v)) reject(new Error("ffprobe returned non-number"));
      else resolve(v);
    });
  });
}

async function ffmpegMux(jobId: string, videoPath: string, audioPath: string, outPath: string) {
  await runCmd(jobId, "ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    outPath,
  ]);
}

async function ffmpegConcat(jobId: string, inputs: string[], outPath: string, workDir: string) {
  const listFile = path.join(workDir, "concat.txt");
  const content = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, content);

  await runCmd(jobId, "ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outPath,
  ]);
}

async function openaiTtsMp3(apiKey: string, text: string): Promise<Buffer> {
  const rsp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: "echo",
      input: text,
      format: "mp3",
    }),
  });

  if (!rsp.ok) {
    const txt = await rsp.text();
    throw new Error(`TTS failed: ${rsp.status} ${txt.slice(0, 800)}`);
  }

  const arr = await rsp.arrayBuffer();
  return Buffer.from(arr);
}

export async function startLocalManimJob(job: ManimJob) {
  const apiKey = (process.env.OPENAI_API_KEY || "").toString().trim();
  if (!apiKey) {
    updateManimJob(job.id, {
      status: "failed",
      step: "error",
      error: "OPENAI_API_KEY missing.",
    });
    finishManimJob(job.id);
    return;
  }

  const baseDir = path.join(process.cwd(), ".manim_jobs");
  const jobDir = path.join(
    baseDir,
    `${job.id}-${sanitizeForFilename(job.prompt) || "job"}`,
  );

  try {
    updateManimJob(job.id, { status: "running", step: "script" });
    await ensureDir(jobDir);

    const client = new OpenAI({ apiKey });

    appendManimJobLog(job.id, "Generating <nar>/<viz> script...");
    const scriptRsp = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You create short educational Manim videos. Output ONLY a script alternating narration and visualization blocks using this exact format: <nar> ... <nar> and <viz> ... <viz>. " +
            "Create 3 to 6 segments total. Narration should be concise. Visualization should be concrete and implementable in Manim.",
        },
        { role: "user", content: job.prompt },
      ],
    });

    const rawScript = (scriptRsp.choices?.[0]?.message?.content || "").toString();
    await writeFile(path.join(jobDir, "script.txt"), rawScript);

    const { nar, viz } = parseNarViz(rawScript);
    if (nar.length === 0 || viz.length === 0) {
      throw new Error("Failed to parse <nar>/<viz> script.");
    }

    await writeFile(path.join(jobDir, "nar.json"), JSON.stringify(nar, null, 2));
    await writeFile(path.join(jobDir, "viz.json"), JSON.stringify(viz, null, 2));

    updateManimJob(job.id, { step: "tts" });
    appendManimJobLog(job.id, `Generating TTS audio for ${nar.length} segments...`);

    const audioDir = path.join(jobDir, "audio");
    await ensureDir(audioDir);

    const audioPaths: string[] = [];
    for (let i = 0; i < nar.length; i++) {
      const mp3 = await openaiTtsMp3(apiKey, nar[i]);
      const p = path.join(audioDir, `script${i + 1}.mp3`);
      await writeFile(p, mp3);
      audioPaths.push(p);
      appendManimJobLog(job.id, `TTS ${i + 1}/${nar.length} written: ${path.basename(p)}`);
    }

    updateManimJob(job.id, { step: "manim_code" });
    appendManimJobLog(job.id, `Generating Manim code for ${viz.length} scenes...`);

    const scriptsDir = path.join(jobDir, "python_scripts");
    await ensureDir(scriptsDir);

    const sceneClassNames: string[] = [];
    const scriptPaths: string[] = [];

    for (let i = 0; i < viz.length; i++) {
      const className = `Script${i + 1}`;
      sceneClassNames.push(className);

      const codeRsp = await client.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You write Manim Community Edition Python code. Return ONLY a Python code block containing a single Scene class. " +
              "No prose. Use from manim import * at top. The class name must be GenScene.",
          },
          {
            role: "user",
            content:
              `Write a Manim scene for this visualization (15-25 seconds max):\n${viz[i]}`,
          },
        ],
      });

      const raw = (codeRsp.choices?.[0]?.message?.content || "").toString();
      const extracted = extractPythonFromMarkdown(raw);
      const forced = forceClassName(extracted, className);
      const fullCode = `from manim import *\nfrom math import *\n\n${forced}\n`;

      const scriptPath = path.join(scriptsDir, `script_${i + 1}.py`);
      await writeFile(scriptPath, fullCode);
      scriptPaths.push(scriptPath);
      await writeFile(path.join(jobDir, `manim_raw_${i + 1}.txt`), raw);
      appendManimJobLog(job.id, `Manim script written: ${path.basename(scriptPath)}`);
    }

    updateManimJob(job.id, { step: "duration" });
    appendManimJobLog(job.id, "Computing audio durations..." );

    const durations: number[] = [];
    for (let i = 0; i < audioPaths.length; i++) {
      const d = await ffprobeDurationSeconds(job.id, audioPaths[i]);
      durations.push(d);
      appendManimJobLog(job.id, `Audio ${i + 1}: ${d.toFixed(2)}s`);
    }

    // Apply duration patch to scripts.
    const processedDir = path.join(jobDir, "processed");
    await ensureDir(processedDir);

    for (let i = 0; i < scriptPaths.length; i++) {
      const src = await fs.readFile(scriptPaths[i], "utf8");
      const patched = setDurationInManimScript(src, durations[i] ?? 12);
      const dest = path.join(processedDir, `script_${i + 1}_processed.py`);
      await writeFile(dest, patched);
    }

    updateManimJob(job.id, { step: "render" });
    appendManimJobLog(job.id, "Rendering scenes with Manim..." );

    const renderDir = path.join(jobDir, "render");
    await ensureDir(renderDir);

    const sceneVideoPaths: string[] = [];
    for (let i = 0; i < scriptPaths.length; i++) {
      const p = path.join(processedDir, `script_${i + 1}_processed.py`);
      const className = `Script${i + 1}`;
      await runCmd(job.id, "manim", [
        "-ql",
        "--format=mp4",
        "--media_dir",
        renderDir,
        "--custom_folders",
        p,
        className,
      ]);

      const mp4s = (await listFilesRecursive(renderDir)).filter((f) => f.endsWith(".mp4"));
      if (mp4s.length === 0) throw new Error("Manim did not produce an mp4.");
      // Heuristic: pick most recently modified file.
      let best = mp4s[0];
      let bestMtime = (await fs.stat(best)).mtimeMs;
      for (const cand of mp4s.slice(1)) {
        const mt = (await fs.stat(cand)).mtimeMs;
        if (mt > bestMtime) {
          best = cand;
          bestMtime = mt;
        }
      }
      sceneVideoPaths.push(best);
      appendManimJobLog(job.id, `Rendered scene ${i + 1}: ${path.relative(jobDir, best)}`);
    }

    updateManimJob(job.id, { step: "stitch" });
    appendManimJobLog(job.id, "Muxing audio into scene videos..." );

    const muxDir = path.join(jobDir, "muxed");
    await ensureDir(muxDir);

    const muxedPaths: string[] = [];
    for (let i = 0; i < sceneVideoPaths.length; i++) {
      const out = path.join(muxDir, `scene_${i + 1}_with_audio.mp4`);
      await ffmpegMux(job.id, sceneVideoPaths[i], audioPaths[i], out);
      muxedPaths.push(out);
    }

    appendManimJobLog(job.id, "Concatenating into final MP4..." );

    const finalPath = path.join(jobDir, "COMPLETE.mp4");
    await ffmpegConcat(job.id, muxedPaths, finalPath, jobDir);

    updateManimJob(job.id, { status: "succeeded", step: "done", videoPath: finalPath });
    appendManimJobLog(job.id, `DONE: ${finalPath}`);
    finishManimJob(job.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateManimJob(job.id, { status: "failed", step: "error", error: msg });
    appendManimJobLog(job.id, `ERROR: ${msg}`);
    finishManimJob(job.id);
  }
}
