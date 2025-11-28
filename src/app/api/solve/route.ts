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

// File path for persisted boards
const HISTORY_FILE = path.join(process.cwd(), "data", "solve_history.json");
type HistoryItem = { question: string; response: string; ts: number };
type Board = { id: string; title: string; createdAt: number; updatedAt: number; items: HistoryItem[] };
type StoreShape = { boards: Board[] } | { sessions: any[] } | any;

async function ensureHistoryDir() {
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readHistory(): Promise<StoreShape> {
  try {
    await ensureHistoryDir();
    const buf = await fs.readFile(HISTORY_FILE, "utf8");
    const data = JSON.parse(buf);
    return data as StoreShape;
  } catch {
    return { boards: [] } as StoreShape;
  }
}

async function writeHistoryFile(shape: StoreShape) {
  await ensureHistoryDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(shape, null, 2), "utf8");
}

function toBoards(shape: StoreShape): Board[] {
  if (Array.isArray((shape as any).boards)) return (shape as any).boards as Board[];
  // migrate legacy sessions -> boards seamlessly
  if (Array.isArray((shape as any).sessions)) return (shape as any).sessions as Board[];
  return [];
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
    const boardIdRaw = form.get("boardId") ?? form.get("sessionId"); // backward compat
    const boardId = (typeof boardIdRaw === "string" ? boardIdRaw : undefined) || makeId();
    
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
    let boards: Board[] = toBoards(shape);
    const existingIdx = boards.findIndex((b) => b.id === boardId);
    const currentBoard: Board =
      existingIdx >= 0
        ? boards[existingIdx]
        : { id: boardId, title: "", createdAt: Date.now(), updatedAt: Date.now(), items: [] };
    const historyString = JSON.stringify(currentBoard.items);

    // Initialize the OpenAI client
    const client = new OpenAI({ apiKey });

    // Load mode detection rules from file (optional, non-fatal if missing)
    let modeRules = "";
    try {
      const rulesPath = path.join(process.cwd(), "mode_detection_rules.txt");
      modeRules = await fs.readFile(rulesPath, "utf8");
    } catch {}

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
            (modeRules ? modeRules + "\n\n" : "") +
            "Response format policy: DO NOT use LaTeX/TeX markup or commands (no \\frac, \\sec, \\tan, $$, \\[, \\], or \\( \\\)). " +
            "Use natural language with inline math using plain text or Unicode symbols where helpful (e.g., ×, ÷, √, ⁰, ¹, ², ³, ⁴, ⁵, ⁶, ⁷, ⁸, ⁹), and function names like sec(x), tan(x). " +
            "When writing powers, use Unicode superscripts (e.g., x², x³) instead of caret notation. For fractions, use a slash (e.g., (a+b)/2) if needed. Keep the output readable as normal text.\n" +
            "Keep within ~120 words unless the image explicitly asks for detailed explanation.\n" +
            "You will be given prior conversation history as a JSON array of items {question, response}. Use it only as context; do not repeat it.\n" +
            "Return ONLY valid JSON with keys: \n" +
            "- message: <final response text>\n" +
            "- question_text: <your best transcription of the question from the image>\n" +
            "- session_title (optional): If this seems to be the first message of a new session, provide a short 2-3 word descriptive title (no quotes, title case)."
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
    // We no longer use AI to name boards

    // Extract any additional fields that might be present in the response
    // These are included for backward compatibility with different response formats
    const answerPlain = (parsed?.answer_plain ?? "").toString().trim();
    const answerLatex = (parsed?.answer_latex ?? "").toString().trim();
    const explanation = (parsed?.explanation ?? "").toString().trim();

    // Persist history with new entry (append in order) to the current board only
    try {
      const now = Date.now();
      const entry: HistoryItem = { question: questionText, response: message, ts: now };
      if (existingIdx >= 0) {
        const next = { ...boards[existingIdx] };
        next.items = [...next.items, entry];
        next.updatedAt = now;
        boards = [...boards];
        boards[existingIdx] = next;
      } else {
        const newBoard: Board = { ...currentBoard, items: [entry], updatedAt: now };
        boards = [newBoard, ...boards];
      }
      await writeHistoryFile({ boards });
    } catch (e) {
      console.error("failed to write solve history:", e);
      // do not fail the request if history persistence fails
    }

    // Return the structured response (include questionText and boardId for UI)
    return json(200, { 
      message, 
      answerPlain, 
      answerLatex, 
      explanation,
      questionText,
      boardId,
    });
    
  } catch (err: any) {
    // Handle any errors that occur during processing
    const message =
      err?.response?.data?.error?.message || err?.message || "Unknown server error.";
    console.error("solve route error:", err);
    return json(500, { error: message });
  }
}
