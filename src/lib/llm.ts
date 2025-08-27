import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function solveFromImage(imageB64: string) {
  // Strict prompt: final answer only keeps MVP simple
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "input_image", image_url: `data:image/png;base64,${imageB64}` } as any,
        {
          type: "text",
          text:
            "Read the handwritten math problem and solve it. " +
            "Reply with ONLY the final numeric/symbolic answer. No prose.",
        } as any,
      ],
    },
  ];

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini", // vision-capable; swap for your provider/model
    messages,
    temperature: 0,
  });

  const out = resp.choices?.[0]?.message?.content?.trim() || "";
  return out;
}
