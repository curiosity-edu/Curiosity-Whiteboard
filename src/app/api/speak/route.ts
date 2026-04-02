import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * POST /api/speak
 *
 * Converts text to natural-sounding speech using OpenAI's TTS API.
 * Returns audio as base64-encoded string for client-side storage in database.
 *
 * Request body:
 * {
 *   "text": "The text to convert to speech"
 * }
 *
 * Returns: JSON with base64-encoded audio
 * {
 *   "audioBase64": "SUQzBAA...",
 *   "speechText": "...",
 *   "mimeType": "audio/mpeg"
 * }
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
      model: "tts-1-hd",
      voice: "alloy",
      input: text,
      speed: 1.0,
    });

    // Convert to Buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Convert to base64 for JSON transmission and storage
    const audioBase64 = buffer.toString("base64");

    return NextResponse.json(
      {
        audioBase64,
        speechText: text,
        mimeType: "audio/mpeg",
      },
      { status: 200 },
    );
  } catch (error) {
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
