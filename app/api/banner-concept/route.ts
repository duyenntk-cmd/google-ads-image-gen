import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Brief {
  app_name: string; headline: string; subheadline: string; cta_text: string;
  primary_color: string; secondary_color: string; accent_color: string;
  background_style: string; mood: string; best_frame_index: number;
  niche: string; app_store_url: string; play_store_url: string;
  subject_position?: string; text_zone?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { appName, prompt, country, language, screenshots, appUrl } = await req.json() as {
      appName: string;
      prompt: string;
      country?: string;
      language?: string;
      screenshots: string[]; // base64 data URIs
      appUrl?: string;
    };

    if (!appName && !prompt) {
      return NextResponse.json({ success: false, error: "Missing appName or prompt" }, { status: 400 });
    }

    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const langCtx = language && language !== "English" ? `Ad copy in ${language}.` : "Ad copy in English.";

    // Build message content with up to 3 screenshots for vision analysis
    const imageContents: OpenAI.Chat.ChatCompletionContentPartImage[] = screenshots
      .slice(0, 3)
      .map(s => ({
        type: "image_url" as const,
        image_url: { url: s, detail: "low" as const },
      }));

    const systemPrompt = `You are a senior Google Ads creative director specializing in mobile app advertising.
Analyze the app screenshots and the user's design brief, then output a JSON design concept for generating 20 banner ads.

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "headline": "string (max 30 chars, punchy benefit)",
  "subheadline": "string (max 60 chars, supporting benefit)",
  "cta_text": "string (max 15 chars, action verb)",
  "primary_color": "#RRGGBB (dominant brand color)",
  "secondary_color": "#RRGGBB (complementary color)",
  "accent_color": "#RRGGBB (CTA/highlight color)",
  "mood": "bold | lifestyle | minimal | product",
  "niche": "photo | tool | office | game | health | finance | social | travel",
  "text_zone": "bottom | top | left | right",
  "subject_position": "center | left | right"
}

Rules:
- headline MUST be ≤30 characters
- cta_text MUST be ≤15 characters
- Choose colors that match the app's visual identity from the screenshots
- mood: bold=strong contrast, lifestyle=aspirational, minimal=clean, product=feature-focused`;

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: `App: ${appName}
${marketCtx} ${langCtx}
User brief: ${prompt || "Create compelling ads that highlight the app's key benefits"}

Analyze the screenshots and create a design concept for Google Ads banners.`,
      },
      ...imageContents,
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() || "{}";
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    let concept: Partial<Brief>;
    try {
      concept = JSON.parse(jsonStr);
    } catch {
      concept = {};
    }

    // Merge with safe defaults
    const brief: Brief = {
      app_name: appName,
      headline: (concept.headline || "Try It Today").slice(0, 30),
      subheadline: (concept.subheadline || "").slice(0, 60),
      cta_text: (concept.cta_text || "Download Now").slice(0, 15),
      primary_color: /^#[0-9A-Fa-f]{6}$/.test(concept.primary_color || "") ? concept.primary_color! : "#0A0A14",
      secondary_color: /^#[0-9A-Fa-f]{6}$/.test(concept.secondary_color || "") ? concept.secondary_color! : "#1A1A2E",
      accent_color: /^#[0-9A-Fa-f]{6}$/.test(concept.accent_color || "") ? concept.accent_color! : "#7C3AED",
      background_style: "blur",
      mood: (["bold","lifestyle","minimal","product"].includes(concept.mood || "") ? concept.mood : "bold") as string,
      niche: concept.niche || "tool",
      best_frame_index: 0,
      app_store_url: appUrl?.includes("apple.com") ? appUrl : "",
      play_store_url: appUrl?.includes("play.google.com") ? appUrl : "",
      text_zone: (["bottom","top","left","right"].includes(concept.text_zone || "") ? concept.text_zone : "bottom") as string,
      subject_position: concept.subject_position || "center",
    };

    return NextResponse.json({ success: true, brief });
  } catch (err) {
    console.error("Banner concept error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
