// src/app/api/solve/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

// Configure the runtime environment for the API route
export const runtime = "nodejs";
// Specify the OpenAI model to use (GPT-4 with vision capabilities)
const MODEL = "gpt-4o";

/**
 * Helper function to create a JSON response with a specific status code
 * @param status - HTTP status code
 * @param data - Response data to be sent as JSON
 * @returns NextResponse with the provided status and data
 */
function json(status: number, data: unknown) {
  return NextResponse.json(data, { status });
}

// File path for persisted conversation history
const HISTORY_FILE = path.join(process.cwd(), "data", "solve_history.json");
type HistoryItem = { question: string; response: string; ts: number };
type Session = { id: string; title: string; createdAt: number; updatedAt: number; items: HistoryItem[] };
type HistoryFileShape = { sessions: Session[] };

async function ensureHistoryDir() {
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readHistory(): Promise<HistoryFileShape> {
  try {
    await ensureHistoryDir();
    const buf = await fs.readFile(HISTORY_FILE, "utf8");
    const data = JSON.parse(buf);
    return data as HistoryFileShape;
  } catch {
    return { sessions: [] } as HistoryFileShape;
  }
}

async function writeHistoryFile(shape: HistoryFileShape) {
  await ensureHistoryDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(shape, null, 2), "utf8");
}

/**
 * POST handler for the /api/solve endpoint
 * Processes an image containing a math problem and returns an AI-generated solution
 */
export async function POST(req: NextRequest) {
  try {
    // Verify API key is configured
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(500, { error: "OPENAI_API_KEY missing." });

    // Parse the form data containing the image
    const form = await req.formData();
    const file = form.get("image");
    const sessionIdRaw = form.get("sessionId");
    const sessionId = (typeof sessionIdRaw === "string" ? sessionIdRaw : undefined) || makeId();
    
    // Validate the uploaded file
    if (!(file instanceof File)) return json(400, { error: "No 'image' file in form-data." });
    if (!file.type.startsWith("image/")) return json(400, { error: `Invalid type: ${file.type}` });

    // Read the file content
    const arr = await file.arrayBuffer();
    if (arr.byteLength === 0) return json(400, { error: "Empty image." });

    // Convert the image to a data URL for the OpenAI API
    const dataUrl = `data:${file.type};base64,${Buffer.from(arr).toString("base64")}`;
    
    // Read prior conversation history and stringify ONLY current session for context
    const shape = await readHistory();
    let sessions: Session[] = Array.isArray((shape as any).sessions) ? (shape as any).sessions : [];
    const existingIdx = sessions.findIndex((s) => s.id === sessionId);
    const currentSession: Session =
      existingIdx >= 0
        ? sessions[existingIdx]
        : { id: sessionId, title: "", createdAt: Date.now(), updatedAt: Date.now(), items: [] };
    const historyString = JSON.stringify(currentSession.items);

    // Initialize the OpenAI client
    const client = new OpenAI({ apiKey });

    // Send the image to OpenAI for processing
    // The system prompt instructs the AI on how to format its response
    const rsp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2, // Lower temperature for more deterministic responses
      response_format: { type: "json_object" } as any, // Force JSON response format
      messages: [
        {
          role: "system",
          content:
            "You are a careful math solver that reads problems from images. " +
            "You must decide the response style from the problem itself:\n" +
            "- If the image explicitly asks for an explanation (e.g., 'explain', 'why', 'show steps/work', 'derive', 'prove', 'justify'), " +
            "  provide a natural, concise explanation: start with the result, then 2–4 short sentences that explain how.\n" +
            "- Otherwise, return a work-only solution: a sequence of line-by-line algebraic transformations with minimal labels (<= 6 words). " +
            "  No paragraphs, no extra commentary. Finish with the final answer on the last line.\n" +
            "Response format policy: DO NOT use LaTeX/TeX markup or commands (no \\\\frac, \\\\sec, \\\\tan, $$, \\[, \\], or \\( \\)). " +
            "Use natural language with inline math using plain text or Unicode symbols where helpful (e.g., ×, ÷, √), and function names like sec(x), tan(x). " +
            "When writing powers or fractions, prefer caret and slash (e.g., x^2, (a+b)/2) if needed. Keep the output readable as normal text.\n" +
            "Keep within ~120 words unless the image explicitly asks for detailed explanation.\n" +
            "You will be given prior conversation history as a JSON array of items {question, response}. Use it only as context; do not repeat it.\n" +
            "Return ONLY valid JSON with keys: \n" +
            "- message: <final response text>\n" +
            "- question_text: <your best transcription of the question from the image>\n" +
            "- session_title (optional): If this seems to be the first message of a new session, provide a short 2-3 word descriptive title (no quotes, title case).",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Here is the prior history as JSON. Use it as context: " + historyString +
                "\nNow read the math in this image and respond using the rules above. " +
                "Important: write your response as natural text with inline math, not LaTeX/TeX. No backslashes or TeX commands. " +
                "Return ONLY JSON with the keys described above.",
            },
            { type: "image_url", image_url: { url: dataUrl } } as any,
          ],
        },
      ],
    });

    // Extract the AI's response
    const raw = rsp.choices?.[0]?.message?.content?.trim() || "{}";

    // Parse the JSON response from the AI
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If parsing fails but we have content, wrap it as the message
      if (!raw) return json(502, { error: "Model returned no content." });
      return json(200, { message: raw });
    }

    // Extract and clean the main message
    const message = (parsed?.message ?? "").toString().trim();
    const questionText = (parsed?.question_text ?? "").toString().trim();
    let sessionTitleFromModel = (parsed?.session_title ?? "").toString().trim();

    // Extract any additional fields that might be present in the response
    // These are included for backward compatibility with different response formats
    const answerPlain = (parsed?.answer_plain ?? "").toString().trim();
    const answerLatex = (parsed?.answer_latex ?? "").toString().trim();
    const explanation = (parsed?.explanation ?? "").toString().trim();

    // Persist history with new entry (append in order) to the current session only
    try {
      const now = Date.now();
      const entry: HistoryItem = { question: questionText, response: message, ts: now };
      if (existingIdx >= 0) {
        const next = { ...sessions[existingIdx] };
        next.items = [...next.items, entry];
        next.updatedAt = now;
        sessions = [...sessions];
        sessions[existingIdx] = next;
      } else {
        // create new session, with title possibly from model
        let title = sessionTitleFromModel;
        if (!title) {
          // Small follow-up call to name the session from the question text
          try {
            const nameRsp = await client.chat.completions.create({
              model: MODEL,
              temperature: 0,
              response_format: { type: "json_object" } as any,
              messages: [
                { role: "system", content: "Return ONLY valid JSON: { \"title\": \"<2-3 word descriptive title in Title Case>\" }" },
                { role: "user", content: `Propose a 2-3 word session title for this question: ${questionText}` },
              ],
            });
            const nameRaw = nameRsp.choices?.[0]?.message?.content?.trim() || "";
            try {
              const nameParsed = JSON.parse(nameRaw);
              title = (nameParsed?.title ?? "").toString().trim();
            } catch {}
          } catch {}
        }
        if (!title) title = "New Session";
        const newSession: Session = { ...currentSession, title, items: [entry], updatedAt: now };
        sessions = [newSession, ...sessions];
      }
      await writeHistoryFile({ sessions });
    } catch (e) {
      console.error("failed to write solve history:", e);
      // do not fail the request if history persistence fails
    }

    // Return the structured response (include questionText and sessionId for UI)
    return json(200, { 
      message, 
      answerPlain, 
      answerLatex, 
      explanation,
      questionText,
      sessionId,
    });
    
  } catch (err: any) {
    // Handle any errors that occur during processing
    const message =
      err?.response?.data?.error?.message || err?.message || "Unknown server error.";
    console.error("solve route error:", err);
    return json(500, { error: message });
  }
}
