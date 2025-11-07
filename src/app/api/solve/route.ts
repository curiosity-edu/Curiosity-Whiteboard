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

async function ensureHistoryDir() {
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
}

async function readHistory(): Promise<HistoryItem[]> {
  try {
    await ensureHistoryDir();
    const buf = await fs.readFile(HISTORY_FILE, "utf8");
    const data = JSON.parse(buf);
    if (Array.isArray(data)) return data as HistoryItem[];
    return [];
  } catch {
    return [];
  }
}

async function writeHistory(items: HistoryItem[]) {
  await ensureHistoryDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(items, null, 2), "utf8");
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
    
    // Validate the uploaded file
    if (!(file instanceof File)) return json(400, { error: "No 'image' file in form-data." });
    if (!file.type.startsWith("image/")) return json(400, { error: `Invalid type: ${file.type}` });

    // Read the file content
    const arr = await file.arrayBuffer();
    if (arr.byteLength === 0) return json(400, { error: "Empty image." });

    // Convert the image to a data URL for the OpenAI API
    const dataUrl = `data:${file.type};base64,${Buffer.from(arr).toString("base64")}`;
    
    // Read prior conversation history and stringify for context
    const history = await readHistory();
    const historyString = JSON.stringify(history);

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
            "Prefer plain text math like 2x^2 + 7x + 5 = 0; use LaTeX fragments only when clearer.\n" +
            "Keep within ~120 words unless the image explicitly asks for detailed explanation.\n" +
            "You will be given prior conversation history as a JSON array of items {question, response}. Use it only as context; do not repeat it.\n" +
            "Return ONLY valid JSON of the form: { \"message\": \"<final response text>\", \"question_text\": \"<your best transcription of the question from the image>\" }.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Here is the prior history as JSON. Use it as context: " + historyString +
                "\nNow read the math in this image and respond using the rules above. " +
                "Return ONLY JSON: { \"message\": \"<final response text>\", \"question_text\": \"<transcribed question text>\" }",
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

    // Extract any additional fields that might be present in the response
    // These are included for backward compatibility with different response formats
    const answerPlain = (parsed?.answer_plain ?? "").toString().trim();
    const answerLatex = (parsed?.answer_latex ?? "").toString().trim();
    const explanation = (parsed?.explanation ?? "").toString().trim();

    // Persist history with new entry (append in order)
    try {
      const newHistory: HistoryItem[] = history.concat({
        question: questionText,
        response: message,
        ts: Date.now(),
      });
      await writeHistory(newHistory);
    } catch (e) {
      console.error("failed to write solve history:", e);
      // do not fail the request if history persistence fails
    }

    // Return the structured response (include questionText for UI archive)
    return json(200, { 
      message, 
      answerPlain, 
      answerLatex, 
      explanation,
      questionText,
    });
    
  } catch (err: any) {
    // Handle any errors that occur during processing
    const message =
      err?.response?.data?.error?.message || err?.message || "Unknown server error.";
    console.error("solve route error:", err);
    return json(500, { error: message });
  }
}
