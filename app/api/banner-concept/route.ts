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

    const systemPrompt = `You are a world-class Google Ads creative director at a top mobile advertising agency. You've shipped campaigns for apps with 100M+ downloads.

Analyze the app screenshots and user brief. Extract the app's true visual identity (real brand colors, real design language) and output the PERFECT design concept for generating high-converting Google Ads banners.

Return ONLY valid JSON (no markdown, no explanation):
{
  "headline": "string (max 30 chars — punchy, benefit-driven, creates desire)",
  "subheadline": "string (max 60 chars — supporting proof point or feature highlight)",
  "cta_text": "string (max 12 chars — strong action verb, urgent)",
  "primary_color": "#RRGGBB (exact dominant brand color from screenshots)",
  "secondary_color": "#RRGGBB (complementary brand color)",
  "accent_color": "#RRGGBB (CTA button color — must have high contrast against primary)",
  "mood": "bold | lifestyle | minimal | product | playful | professional",
  "niche": "photo | tool | office | game | health | finance | social | travel",
  "text_zone": "bottom | top | left | right",
  "subject_position": "center | left | right"
}

CRITICAL RULES:
- headline: MUST be ≤30 chars. Make it emotionally compelling, not just descriptive. Focus on the #1 user benefit.
- cta_text: MUST be ≤12 chars. Use urgent action verbs: "Try Free", "Install Now", "Get Started", "Play Free"
- primary_color: Extract THE ACTUAL dominant color from the app screenshots — don't guess, look at the UI
- accent_color: Must contrast strongly with primary_color for the CTA button to stand out
- mood: bold=cinematic high-contrast, lifestyle=aspirational warm, minimal=Apple-style clean, product=feature showcase, playful=vibrant fun, professional=corporate trust`;

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
