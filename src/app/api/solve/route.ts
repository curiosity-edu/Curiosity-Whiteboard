// src/app/api/solve/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    
    // Validate the uploaded file
    if (!(file instanceof File)) return json(400, { error: "No 'image' file in form-data." });
    if (!file.type.startsWith("image/")) return json(400, { error: `Invalid type: ${file.type}` });

    // Read the file content
    const arr = await file.arrayBuffer();
    if (arr.byteLength === 0) return json(400, { error: "Empty image." });

    // Convert the image to a data URL for the OpenAI API
    const dataUrl = `data:${file.type};base64,${Buffer.from(arr).toString("base64")}`;
    
    // Read prior conversation history from client (Firestore-backed when signed in)
    let historyString = "[]";
    if (typeof historyRaw === "string") {
      historyString = historyRaw;
    }

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