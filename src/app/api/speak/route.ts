import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * POST /api/speak
 *
 * Converts text to natural-sounding speech using OpenAI's TTS API.
 *
 * Request body:
 * {
 *   "text": "The text to convert to speech"
 * }
 *
 * Returns: Audio file (MP3) as a Blob
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'text' parameter" },
        { status: 400 },
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error("[TTS] OPENAI_API_KEY not configured");
      return NextResponse.json(
        { error: "TTS service not configured" },
        { status: 500 },
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Use OpenAI's text-to-speech API with a natural-sounding voice
    const mp3 = await openai.audio.speech.create({
      model: "tts-1-hd", // High-definition version for better quality
      voice: "alloy", // You can also use: "echo", "fable", "onyx", "nova", "shimmer"
      input: text,
      speed: 1.0,
    });

    // Convert the response to a Buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Return the audio as MP3
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[TTS] Error:", error);

    if (error instanceof Error) {
      if (error.message.includes("401")) {
        return NextResponse.json(
          { error: "OpenAI API authentication failed" },
          { status: 401 },
        );
      }
      if (error.message.includes("429")) {
        return NextResponse.json(
          { error: "Rate limited. Please try again later" },
          { status: 429 },
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 },
    );
  }
}
