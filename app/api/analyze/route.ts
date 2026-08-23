import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { frames, selectedFrames, niche, userPrompt, language, country } = await req.json();
    const lang = language || "English";
    const mkt = country && country !== "Global" ? country : null;

    // Support both old format (frames[]) and new format (selectedFrames[])
    let framesToUse: { base64: string }[] = selectedFrames || [];
    if (!framesToUse.length && frames && frames.length) {
      const indices = frames.length <= 4
        ? frames.map((_: unknown, i: number) => i)
        : [0, Math.floor(frames.length * 0.33), Math.floor(frames.length * 0.66), frames.length - 1];
      framesToUse = indices.map((i: number) => ({ base64: frames[i].base64 }));
    }

    const imageBlocks = framesToUse.map(f => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/jpeg" as const,
        data: f.base64,
      },
    }));

    const marketContext = mkt
      ? `\nTarget market: ${mkt}. Localize copy to resonate with ${mkt} audiences — consider cultural tone, local idioms, and typical aesthetic preferences.`
      : "";

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: `You are a senior Google App Campaign creative strategist. Analyze these video frames from a ${niche || "mobile"} app ad and generate optimal banner creative assets.

GOOGLE ADS CREATIVE BEST PRACTICES to follow:
- Headlines: Use AIDA formula (Attention → Interest → Desire → Action). Must be benefit-focused, not feature-focused.
- Avoid generic phrases like "Download Now", "Best App", "Free App". Instead use specific benefits.
- CTA should create urgency or reduce friction (e.g. "Try Free 7 Days", "Start for Free", "Get It Free")
- Colors: Primary should be the dominant brand color. Accent (CTA) must have high contrast ratio (≥4.5:1) against primary for accessibility.
- Mood must match niche: photo=vibrant/creative, tool=clean/professional, office=trustworthy/corporate
- Subheadline: social proof or specific feature that supports headline

CHARACTER LIMITS (strict):
- headline: max 30 characters (shorter = better for small banner sizes)
- subheadline: max 60 characters
- cta_text: max 15 characters

Return ONLY a valid JSON object, no markdown, no explanation:

{
  "app_name": "app name visible in video, else empty string",
  "primary_color": "#hex - dominant brand/background color from the video",
  "secondary_color": "#hex - secondary brand color",
  "accent_color": "#hex - high-contrast CTA color, must stand out strongly against primary",
  "background_style": "dark|light|gradient",
  "mood": "bold|minimal|professional|playful|vibrant",
  "headline": "benefit-focused headline max 30 chars in ${lang}",
  "subheadline": "supporting proof/feature max 60 chars in ${lang}",
  "cta_text": "action CTA max 15 chars in ${lang}",
  "best_frame_index": 0,
  "layout_suggestion": "lifestyle|product|minimal|bold"
}

layout_suggestion guide:
- lifestyle: use when video shows people/lifestyle scenes (best for emotional connection)
- product: use when video shows app UI/screenshots prominently
- minimal: use when background is clean/simple
- bold: use when video has strong colors and energy${marketContext}${userPrompt ? `\nAdditional context: ${userPrompt}` : ""}`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = text.replace(/```json|```/g, "").trim();
    const brief = JSON.parse(clean);

    // Enforce character limits
    if (brief.headline) brief.headline = brief.headline.slice(0, 30);
    if (brief.subheadline) brief.subheadline = brief.subheadline.slice(0, 60);
    if (brief.cta_text) brief.cta_text = brief.cta_text.slice(0, 15);

    return NextResponse.json({ success: true, brief });
  } catch (err) {
    console.error("Analyze error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
