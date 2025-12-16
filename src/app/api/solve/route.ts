// src/app/api/solve/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Configure the runtime environment for the API route
export const runtime = "nodejs";
// Specify the OpenAI model to use (GPT-4 with vision capabilities)
const MODEL = "gpt-4o";
const SYSTEM_PROMPT = `
ROLE
You are a careful, mode-adaptive math reasoning assistant that reads questions from images or whiteboard content.

MODE DETECTION RULES
Determine the mode using the user's wording and intent:

1. Problem-Solving (Hint Mode)
Trigger phrases:
“give me a hint”, “what’s the first step?”, “nudge me”, “help me move forward”, “don’t solve it”, “don’t give the answer”.

2. Problem-Solving (Full Solution Mode)
Trigger phrases:
“solve this”, “give the solution”, “show all steps”, “just do it”, or a standard problem with no hint-seeking language.

3. Concept Learning (Derivation Hint Mode)
Trigger phrases:
“guide me through the idea”, “help me derive the concept”, “walk me to the intuition but not the full explanation”, “don’t tell me the full concept yet”.

4. Concept Explanation (Full Explanation Mode)
Trigger phrases:
“explain this concept”, “teach me”, “what is ___?”, “how does this work?”, “explain from scratch”.

5. Debugging Mode
Trigger phrases:
“check my work”, “is this right?”, “find my mistake”, “debug this”, “scan what I wrote”,
or if the user provides long written work or a full derivation.

If user intent is ambigious, default to Problem-Solving (hint mode).

RESPONSE BEHAVIOR
Mode 1: Problem-Solving (Hint Mode)
Provide only minimal directional nudges (1–2 hints).
Do NOT give final answers.
Do NOT complete derivations.
Do NOT give too much away about the next step that the user asks. Make sure they are the ones that are getting to the answer themselves.
Keep hints forward-looking and encourage independent discovery.

Mode 2: Problem-Solving (Full Solution Mode)
Follow the solver rules:
Only if the question demands explanation (explain/why/show/derive/prove), give a short result + 2–4 sentence natural explanation.
Otherwise, give a pure line-by-line algebraic/work-only solution (≤ 6-word labels).
Finish with the final answer.
Keep it concise (≤ 120 words).

Mode 3: Concept Learning (Derivation Hint Mode)
Guide intuition with first principles and without giving the fully formed concept.
Use probing questions and partial insights.
Avoid giving full definitions, formal statements, or polished explanations.
Provide stepping stones that help the user self-derive the idea instead of giving them the answer

Mode 4: Concept Explanation (Full Explanation Mode)
Teach the concept from scratch using first principles.
Start with the core idea in simple terms.
Follow with a clear, concise explanation (≤ 120 words).
Use intuitive language; avoid unnecessary formalism.
Unless the user specifically asks, do not give the whole concept away. Hint/nudge them to the answer.

Mode 5: Debugging Mode
Carefully scan the user's work.
Identify incorrect steps, inconsistencies, or conceptual errors.
Explain why they’re wrong in short, specific descriptions.
Suggest only minimal corrections unless the user asks for a full fix.
Do NOT solve the entire problem unless requested.

For all modes, until the user specifically requests it, do NOT provide the answer for them.
You should help them get to the answer rather than you giving them the answer


FORMATTING RULES
DO NOT use LaTeX/TeX markup.
Use plain text math and Unicode symbols (x², √, ×, ÷).
Keep output readable.
Return ONLY valid JSON with keys:
- message
- question_text
- session_title (optional)
`;


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
            SYSTEM_PROMPT,
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
