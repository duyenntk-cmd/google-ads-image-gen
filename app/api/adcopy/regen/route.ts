import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 20;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LIMITS: Record<string, number> = { headline: 30, description: 90, cta: 15 };

export async function POST(req: NextRequest) {
  try {
    const { type, appName, message, country, language, existing } = await req.json() as {
      type: "headline" | "description" | "cta";
      appName: string;
      message?: string;
      country?: string;
      language?: string;
      existing?: string[];
    };

    if (!type || !appName) return NextResponse.json({ success: false, error: "Missing type or appName" }, { status: 400 });

    const limit = LIMITS[type];
    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const langCtx = language && language !== "English" ? `Write in ${language}.` : "Write in English.";
    const existingCtx = existing?.length
      ? `Already used ${type}s (do NOT repeat): ${existing.map(s => `"${s}"`).join(", ")}.`
      : "";

    const typeDesc = type === "headline"
      ? `a Google Ads headline (MAX ${limit} characters, punchy benefit/urgency/proof angle)`
      : type === "description"
      ? `a Google Ads description (MAX ${limit} characters, expands on a value proposition)`
      : `a Google Ads call-to-action (MAX ${limit} characters, action verb like Download/Try/Get)`;

    const prompt = `You are an expert Google Ads copywriter for mobile apps.

App: ${appName}${message ? `\nKey message: ${message}` : ""}
${marketCtx} ${langCtx}
${existingCtx}

Write exactly 1 new ${typeDesc}.
STRICT rule: output MUST be ${limit} characters or fewer. Count every character carefully.
Return ONLY the text, no quotes, no explanation.`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });

    let text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    // Strip surrounding quotes if model adds them
    text = text.replace(/^["']|["']$/g, "").trim();
    // Hard truncate as last resort
    if (text.length > limit) text = text.slice(0, limit).trimEnd();

    return NextResponse.json({ success: true, text });
  } catch (err) {
    console.error("AdCopy regen error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
