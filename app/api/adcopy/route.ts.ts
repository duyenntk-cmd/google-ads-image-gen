import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { appName, message, country, language } = await req.json();
    if (!appName) return NextResponse.json({ success: false, error: "Missing appName" }, { status: 400 });

    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const langCtx = language && language !== "English" ? `Write all copy in ${language}.` : "Write in English.";

    const prompt = `You are an expert Google Ads copywriter specializing in mobile app advertising.

App: ${appName}
${message ? `Key message: ${message}` : ""}
${marketCtx} ${langCtx}

Generate Google Ads copy with strict character limits. Return ONLY valid JSON, no markdown:
{
  "headlines": ["h1", "h2", "h3", "h4", "h5"],
  "descriptions": ["d1", "d2", "d3", "d4", "d5"],
  "ctas": ["cta1", "cta2", "cta3", "cta4", "cta5"]
}

Rules:
- headlines: exactly 5 items, each MAX 30 characters (count carefully). Varied angles: benefit, urgency, social proof, feature, emotional.
- descriptions: exactly 5 items, each MAX 90 characters. Expand on the headline value proposition.
- ctas: exactly 5 items, each MAX 15 characters. Action verbs (Download, Try Free, Get Started, Install Now, Open App).
- All text must be in ${language || "English"}.
- Make them compelling and relevant to ${country || "global"} users.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const result = JSON.parse(jsonMatch[0]);
    // Ensure exactly 4 descriptions and 5 headlines/ctas
    while ((result.descriptions || []).length < 5) result.descriptions.push("Discover the app everyone is talking about. Download free today.");
    while ((result.headlines || []).length < 5) result.headlines.push("Try It Free Today");
    while ((result.ctas || []).length < 5) result.ctas.push("Download Now");
    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error("AdCopy error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
