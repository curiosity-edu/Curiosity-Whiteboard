// src/app/api/solve/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Configure the runtime environment for the API route
export const runtime = "nodejs";
// Specify the OpenAI model to use (GPT-4 with vision capabilities)
const MODEL = "gpt-4o";

const DEBUG_SOLVE =
  (process.env.CURIOSITY_DEBUG_SOLVE || "").toString().trim() === "1";

// Shared response format policy used in both image and voice-only flows
const RESPONSE_FORMAT_POLICY =
  "Response format policy: Use readable Markdown for structure (bold with **like this**). " +
  "For math, you MAY use LaTeX, but you MUST wrap it as inline math using $...$ or display math using $$...$$ so the client can render it. " +
  "Never output raw LaTeX commands like \\int, \\mathbf, \\partial, \\nabla, etc. unless they are INSIDE $...$ or $$...$$. " +
  "Do not output partial-math like (a+b)^2 with only part delimited; the ENTIRE expression must be within a single pair of math delimiters. " +
  "If you write LaTeX, keep it minimal and standard (e.g., \\frac{a}{b}, \\sqrt{x}).\n" +
  "Keep within ~120 words unless the prompt explicitly asks for detailed explanation.\n" +
  "You will be given prior conversation history as a JSON array of items {question, response}. Use it only as context; do not repeat it.\n" +
  "Return ONLY valid JSON with keys: \n" +
  "- message: <final response text>\n" +
  "- question_text: <your best transcription of the question>\n" +
  "- mode_category: <what mode was detected in this situation>\n" +
  "- session_title (optional): If this seems to be the first message of a new session, provide a short 2-3 word descriptive title (no quotes, title case).";
async function loadModeDetectionRules(): Promise<string> {
  try {
    const rulesPath = path.join(process.cwd(), "mode_detection_rules.txt");
    const txt = await readFile(rulesPath, "utf8");
    const trimmed = (txt || "").trim();
    return trimmed ? `\n\nMode Detection Rules:\n${trimmed}` : "";
  } catch {
    return "";
  }
}

 function debugLog(label: string, data: unknown) {
   if (!DEBUG_SOLVE) return;
   try {
     const s = typeof data === "string" ? data : JSON.stringify(data, null, 2);
     console.log(`[solve][debug] ${label}:`, (s || "").slice(0, 6000));
   } catch {
     try {
       console.log(`[solve][debug] ${label}:`, data);
     } catch {}
   }
 }

/**
 * Helper function to create a JSON response with a specific status code
 * @param status - HTTP status code
 * @param data - Response data to be sent as JSON
 * @returns NextResponse with the provided status and data
 */
function json(status: number, data: unknown) {
  return NextResponse.json(data, { status });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeLatex(text: string) {
  return (text || "").toString();
}

function parseModelJson(raw: string) {
  const txt = (raw || "").trim();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {}

  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = txt.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {}
  }
  return null;
}

function readModeCategory(parsed: any) {
  const v =
    (parsed?.mode_category ?? parsed?.modeCategory ?? "").toString().trim();
  return v;
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
    const historyRaw = form.get("history");
    const questionRaw = form.get("question");
    const question = typeof questionRaw === "string" ? questionRaw.trim() : "";

    // Read prior conversation history from client (Firestore-backed when signed in)
    let historyString = "[]";
    if (typeof historyRaw === "string") {
      historyString = historyRaw;
    }

    // Initialize the OpenAI client
    const client = new OpenAI({ apiKey });

    async function solveFromTextOnly(rules: string) {
      const rsp = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" } as any,
        messages: [
          {
            role: "system",
            content: rules + RESPONSE_FORMAT_POLICY,
          },
          {
            role: "user",
            content:
              "Here is the prior history as JSON. Use it as context: " +
              historyString +
              "\nNow answer this question: " +
              question +
              "\nFormatting requirements:\n" +
              "- Use Markdown for structure (you may use **bold**).\n" +
              "- ALL math must be wrapped as $...$ (inline) or $$...$$ (display).\n" +
              "- For display math, put the $$ delimiters on their own lines.\n" +
              "- Do NOT present equations inside ((double parentheses)) or [square brackets]; use $$...$$ instead.\n" +
              "Return ONLY JSON with the keys described above."
          },
        ],
      });

      const raw = rsp.choices?.[0]?.message?.content?.trim() || "{}";
      debugLog("raw_model_content_text_only", raw);
      const parsed: any = parseModelJson(raw);
      if (!parsed) {
        if (!raw) return json(502, { error: "Model returned no content." });
        return json(200, {
          message: sanitizeLatex(raw),
          questionText: question,
          boardId,
          modeCategory: "",
        });
      }

      const messageRaw = (parsed?.message ?? "").toString().trim();
      debugLog("parsed_message_text_only", messageRaw);
      const message = sanitizeLatex(messageRaw);
      const questionText = (parsed?.question_text ?? "").toString().trim();
      const answerPlain = (parsed?.answer_plain ?? "").toString().trim();
      const answerLatex = (parsed?.answer_latex ?? "").toString().trim();
      const explanation = (parsed?.explanation ?? "").toString().trim();
      const modeCategory = readModeCategory(parsed);

      return json(200, {
        message,
        answerPlain,
        answerLatex,
        explanation,
        questionText: questionText || question,
        boardId,
        modeCategory,
      });
    }

    // If no image was provided, allow a text-only solve (voice-only flow).
    if (!(file instanceof File)) {
      if (!question) return json(400, { error: "No 'image' file in form-data." });
      const rules = await loadModeDetectionRules();
      return await solveFromTextOnly(rules);
    }

    // Validate the uploaded file
    if (!file.type.startsWith("image/")) return json(400, { error: `Invalid type: ${file.type}` });

    // Read the file content
    const arr = await file.arrayBuffer();
    if (arr.byteLength === 0) return json(400, { error: "Empty image." });

    // Convert the image to a data URL for the OpenAI API
    const dataUrl = `data:${file.type};base64,${Buffer.from(arr).toString("base64")}`;

    // Send the image to OpenAI for processing
    // The system prompt instructs the AI on how to format its response
    const rules = await loadModeDetectionRules();
    const rsp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2, // Lower temperature for more deterministic responses
      response_format: { type: "json_object" } as any, // Force JSON response format
      messages: [
        {
          role: "system",
          content: rules + RESPONSE_FORMAT_POLICY
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Here is the prior history as JSON. Use it as context: " + historyString +
                (question
                  ? "\nNow answer this question (from voice): " +
                    question +
                    "\nUse the image only if it contains relevant information. If the image is unclear, unrelated, or unreadable, ignore it and still answer the voice question. You MUST still answer the voice question. "
                  : "\nNow read the math in this image and respond using the rules above. ") +
                "\nFormatting requirements:\n" +
                "- Use Markdown for structure (you may use **bold**).\n" +
                "- ALL math must be wrapped as $...$ (inline) or $$...$$ (display).\n" +
                "- For display math, put the $$ delimiters on their own lines.\n" +
                "- Do NOT present equations inside ((double parentheses)) or [square brackets]; use $$...$$ instead.\n" +
                "Return ONLY JSON with the keys described above."
            },
            { type: "image_url", image_url: { url: dataUrl } } as any,
          ],
        },
      ],
    });

    // Extract the AI's response
    const raw = rsp.choices?.[0]?.message?.content?.trim() || "{}";

    // Parse the JSON response from the AI
    const parsed: any = parseModelJson(raw);
    if (!parsed) {
      if (!raw) return json(502, { error: "Model returned no content." });
      return json(200, {
        message: sanitizeLatex(raw),
        questionText: question,
        boardId,
        modeCategory: "",
      });
    }

    // Extract and clean the main message
    const messageRaw = (parsed?.message ?? "").toString().trim();
    debugLog("parsed_message_image", messageRaw);
    const message = sanitizeLatex(messageRaw);
    const questionText = (parsed?.question_text ?? "").toString().trim();
    // We no longer use AI to name boards

    // Extract any additional fields that might be present in the response
    // These are included for backward compatibility with different response formats
    const answerPlain = (parsed?.answer_plain ?? "").toString().trim();
    const answerLatex = (parsed?.answer_latex ?? "").toString().trim();
    const explanation = (parsed?.explanation ?? "").toString().trim();
    const modeCategory = readModeCategory(parsed);

    // Return the structured response (include questionText and boardId for UI)
    const looksUnreadable = /could not read|can't read|cannot read|unable to read|unreadable|meaningless scribbles|could not parse|can't parse|cannot parse|unable to parse|no (?:problem|question) found|nothing (?:to solve|to answer)|image (?:is )?(?:blank|empty|unclear)/i.test(
      message
    );

    const looksEmpty =
      !message && !answerPlain && !answerLatex && !explanation;

    if (question && (looksEmpty || looksUnreadable)) {
      const rules = await loadModeDetectionRules();
      return await solveFromTextOnly(rules);
    }

    return json(200, { 
      message, 
      answerPlain, 
      answerLatex, 
      explanation,
      questionText: questionText || question,
      boardId,
      modeCategory,
    });
    
  } catch (err: any) {
    // Handle any errors that occur during processing
    const message =
      err?.response?.data?.error?.message || err?.message || "Unknown server error.";
    console.error("solve route error:", err);
    return json(500, { error: message });
  }
}