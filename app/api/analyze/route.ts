import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { frames, niche, userPrompt } = await req.json();

    // Pick 4 representative frames (spread across the set)
    const indices = frames.length <= 4
      ? frames.map((_: unknown, i: number) => i)
      : [0, Math.floor(frames.length * 0.33), Math.floor(frames.length * 0.66), frames.length - 1];

    const imageBlocks = indices.map((i: number) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/jpeg" as const,
        data: frames[i].base64,
      },
    }));

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: `These are frames from a mobile app advertisement video for a ${niche || "mobile"} app.
Analyze the visual style and return ONLY a JSON object with no markdown, no explanation:

{
  "app_name": "app name if visible, else empty string",
  "primary_color": "#hex dominant background color",
  "secondary_color": "#hex secondary color",
  "accent_color": "#hex button/CTA color (bright, contrasting)",
  "background_style": "dark|light|gradient",
  "headline": "short punchy headline (max 8 words) matching the app's benefit",
  "subheadline": "supporting text (max 12 words)",
  "cta_text": "CTA button text (2-4 words, e.g. Try Free, Edit Now)",
  "best_frame_index": 0,
  "mood": "bold|minimal|professional|playful"
}${userPrompt ? `\nAdditional context from user: ${userPrompt}` : ""}`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = text.replace(/```json|```/g, "").trim();
    const brief = JSON.parse(clean);

    return NextResponse.json({ success: true, brief });
  } catch (err) {
    console.error("Analyze error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
