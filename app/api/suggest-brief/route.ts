import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COLOR_PALETTES: Record<string, { primary: string; secondary: string; accent: string; name: string }[]> = {
  photo: [
    { primary: "#7B2FBE", secondary: "#E91E8C", accent: "#FF6B35", name: "Purple Magenta" },
    { primary: "#0F172A", secondary: "#7C3AED", accent: "#F59E0B", name: "Dark Purple Gold" },
    { primary: "#BE185D", secondary: "#9333EA", accent: "#06B6D4", name: "Pink Purple Cyan" },
    { primary: "#1E1B4B", secondary: "#4F46E5", accent: "#EC4899", name: "Indigo Pink" },
    { primary: "#064E3B", secondary: "#10B981", accent: "#F59E0B", name: "Emerald Gold" },
  ],
  tool: [
    { primary: "#2563EB", secondary: "#60A5FA", accent: "#059669", name: "Blue Green" },
    { primary: "#0F172A", secondary: "#3B82F6", accent: "#10B981", name: "Dark Blue Mint" },
    { primary: "#1D4ED8", secondary: "#06B6D4", accent: "#F59E0B", name: "Blue Cyan Gold" },
    { primary: "#0C4A6E", secondary: "#0EA5E9", accent: "#22C55E", name: "Ocean Green" },
    { primary: "#312E81", secondary: "#6366F1", accent: "#F97316", name: "Indigo Orange" },
  ],
  office: [
    { primary: "#1E3A5F", secondary: "#2563EB", accent: "#3B82F6", name: "Navy Blue" },
    { primary: "#0F172A", secondary: "#1D4ED8", accent: "#F59E0B", name: "Dark Navy Gold" },
    { primary: "#1E293B", secondary: "#475569", accent: "#3B82F6", name: "Slate Blue" },
    { primary: "#042F2E", secondary: "#0F766E", accent: "#F59E0B", name: "Teal Gold" },
    { primary: "#27272A", secondary: "#52525B", accent: "#A78BFA", name: "Dark Purple" },
  ],
};

export async function POST(req: NextRequest) {
  try {
    const { app_name, niche, headline, subheadline, cta_text } = await req.json();

    if (!app_name) {
      return NextResponse.json({ success: false, error: "Missing app_name" }, { status: 400 });
    }

    const nicheLabel = niche === "photo" ? "Photo/Camera app" : niche === "tool" ? "Productivity/Tool app" : "Office/Business app";
    const currentInfo = headline ? `Current: headline="${headline}", subheadline="${subheadline}", cta="${cta_text}"` : "";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `Generate 3 variations of ad copy for a Google Ads banner for "${app_name}" (${nicheLabel}).
${currentInfo}

Rules:
- Headline: max 30 chars, punchy, benefit-focused
- Subheadline: max 40 chars, feature or proof point
- CTA: max 15 chars, action verb

Return ONLY valid JSON array, no markdown:
[
  {"headline":"...","subheadline":"...","cta":"...","label":"..."},
  {"headline":"...","subheadline":"...","cta":"...","label":"..."},
  {"headline":"...","subheadline":"...","cta":"...","label":"..."}
]`
      }]
    });

    const raw = (message.content[0] as { text: string }).text.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Invalid AI response");
    const suggestions = JSON.parse(jsonMatch[0]);

    // Pick 3 random palettes for the niche
    const palettes = COLOR_PALETTES[niche] || COLOR_PALETTES.photo;
    const shuffled = [...palettes].sort(() => Math.random() - 0.5).slice(0, 3);

    return NextResponse.json({ success: true, suggestions, palettes: shuffled });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
