import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { appName, niche, screenshots, country, language } = await req.json() as {
      appName: string;
      niche?: string;
      screenshots?: string[];
      country?: string;
      language?: string;
    };

    if (!appName) {
      return NextResponse.json({ success: false, error: "Missing appName" }, { status: 400 });
    }

    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const langCtx = language && language !== "English" ? `Ad copy language: ${language}.` : "";

    const imageContents: OpenAI.Chat.ChatCompletionContentPartImage[] = (screenshots || [])
      .slice(0, 2)
      .map(s => ({
        type: "image_url" as const,
        image_url: { url: s, detail: "low" as const },
      }));

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: `App: "${appName}"${niche ? `, category: ${niche}` : ""}. ${marketCtx} ${langCtx}

Write a creative direction prompt for generating Google Ads banner images for this app.`,
      },
      ...imageContents,
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a Google Ads creative director. Given an app, write a 1-2 sentence creative direction prompt that describes:
- The visual style and mood (e.g. "bold cinematic style with deep purple gradients")
- The hero visual element (e.g. "showcase a phone mockup with the photo editing interface")
- The target emotion (e.g. "inspire creativity and make users feel empowered")
- Any specific design elements to emphasize

Write in English, concise, vivid, actionable. Do NOT repeat the app name. Output only the prompt text, no explanation.`,
        },
        { role: "user", content: userContent },
      ],
    });

    const prompt = response.choices[0]?.message?.content?.trim() || "";

    return NextResponse.json({ success: true, prompt });
  } catch (err) {
    console.error("Auto prompt error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
