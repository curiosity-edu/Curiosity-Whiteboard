// src/app/api/solve/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

function json(status: number, data: unknown) {
  return NextResponse.json(data, { status });
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, { error: "Server misconfig: OPENAI_API_KEY is missing." });
    }

    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return json(400, { error: "No image file found in form-data as 'image'." });
    }
    if (!file.type.startsWith("image/")) {
      return json(400, { error: `Invalid file type: ${file.type}` });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength === 0) {
      return json(400, { error: "Uploaded image is empty." });
    }

    // Data URL to send to the vision model
    const dataUrl = `data:${file.type};base64,${buf.toString("base64")}`;

    const client = new OpenAI({ apiKey });

    // ✅ Chat Completions with image: use { type: "image_url", image_url: { url: ... } }
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini", // vision-capable
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Read the handwritten math problem and solve it. " //+
                // "Reply with ONLY the final numeric/symbolic answer unless the user answers requests an explanation.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            } as any,
          ],
        },
      ],
    });

    const answer = resp.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      return json(502, { error: "Model did not return an answer." });
    }
    return json(200, { answer });
  } catch (err: any) {
    const message =
      err?.response?.data?.error?.message ||
      err?.message ||
      "Unknown server error.";
    console.error("solve route error:", err);
    return json(500, { error: message });
  }
}
