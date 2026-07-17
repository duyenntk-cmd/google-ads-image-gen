import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 45;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const ct = res.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

async function fetchAppStoreData(id: string) {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${id}`);
  const data = await res.json();
  const app = data.results?.[0];
  if (!app) return null;
  return {
    name: app.trackName as string,
    description: (app.description as string)?.slice(0, 500) || "",
    category: app.primaryGenreName as string,
    iconUrl: (app.artworkUrl512 || app.artworkUrl100) as string,
    screenshotUrls: (app.screenshotUrls || []) as string[],
    rating: app.averageUserRating as number,
    ratingCount: app.userRatingCount as number,
  };
}

async function fetchPlayStoreData(pkg: string) {
  try {
    const res = await fetch("/api/app-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId: pkg }),
    });
    const data = await res.json();
    return data.name ? { name: data.name as string, description: "", category: "", iconUrl: "", screenshotUrls: [] as string[], rating: 0, ratingCount: 0 } : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { appUrl, keywords, country, language, niche } = await req.json();
    if (!appUrl?.trim()) return NextResponse.json({ success: false, error: "Missing appUrl" }, { status: 400 });

    // Parse URL
    const url = appUrl.trim();
    const iosMatch = url.match(/apps\.apple\.com\/[^/]+\/app\/([^/]+)\/id(\d+)/) || url.match(/apps\.apple\.com.*\/id(\d+)/);
    const androidMatch = url.match(/id=([a-zA-Z0-9._]+)/);

    let appMeta: { name: string; description: string; category: string; iconUrl: string; screenshotUrls: string[]; rating: number; ratingCount: number; } | null = null;
    let platform = "unknown";

    if (iosMatch) {
      const id = iosMatch[2] || iosMatch[1];
      appMeta = await fetchAppStoreData(id);
      platform = "iOS";
    } else if (androidMatch) {
      appMeta = await fetchPlayStoreData(androidMatch[1]);
      platform = "Android";
    }

    if (!appMeta) return NextResponse.json({ success: false, error: "Không thể lấy thông tin app từ URL này" }, { status: 400 });

    // Fetch screenshot + icon in parallel
    const [screenshotB64, iconB64] = await Promise.all([
      appMeta.screenshotUrls?.[0] ? fetchImageAsBase64(appMeta.screenshotUrls[0]) : Promise.resolve(null),
      appMeta.iconUrl ? fetchImageAsBase64(appMeta.iconUrl) : Promise.resolve(null),
    ]);

    // Generate brief with Claude
    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const kwCtx = keywords?.trim() ? `Key selling points / keywords: ${keywords}` : "";
    const ratingCtx = appMeta.rating ? `App rating: ${appMeta.rating.toFixed(1)}/5 (${appMeta.ratingCount?.toLocaleString()} ratings).` : "";

    const messages: Anthropic.MessageParam[] = [];
    const contentParts: Anthropic.ContentBlockParam[] = [];

    // Add screenshot for visual analysis if available
    if (screenshotB64) {
      const b64Data = screenshotB64.split(",")[1];
      const mtype = screenshotB64.startsWith("data:image/png") ? "image/png" : "image/jpeg";
      contentParts.push({
        type: "image",
        source: { type: "base64", media_type: mtype, data: b64Data },
      } as Anthropic.ImageBlockParam);
    }

    contentParts.push({
      type: "text",
      text: `You are a Google Ads creative director for mobile apps.

App: ${appMeta.name}
Platform: ${platform}
Category: ${appMeta.category || niche || "App"}
${ratingCtx}
${kwCtx}
Description: ${appMeta.description}
${marketCtx}
Language for ad copy: ${language || "English"}
${screenshotB64 ? "The app screenshot is shown above — use it to inform colors and visual style." : ""}

Generate a complete Google Ads creative brief. Return ONLY valid JSON, no markdown:
{
  "app_name": "${appMeta.name}",
  "headline": "short punchy headline MAX 30 chars",
  "subheadline": "supporting line MAX 50 chars",
  "cta_text": "CTA MAX 12 chars",
  "primary_color": "#hexcode",
  "secondary_color": "#hexcode",
  "accent_color": "#hexcode",
  "background_style": "dark or light",
  "mood": "bold or elegant or playful or minimal or professional",
  "best_frame_index": 0,
  "niche": "${niche || "tool"}",
  "app_store_url": "${platform === "iOS" ? url : ""}",
  "play_store_url": "${platform === "Android" ? url : ""}"
}

Rules:
- headline/subheadline/cta_text must be in ${language || "English"}
- Colors should match the app's visual identity${screenshotB64 ? " — analyze the screenshot" : ""}
- primary_color: dominant brand color
- secondary_color: complementary color
- accent_color: CTA button color (high contrast, eye-catching)
- mood: choose what fits the app category and target market`,
    });

    messages.push({ role: "user", content: contentParts });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const brief = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      success: true,
      brief,
      screenshotBase64: screenshotB64,
      iconBase64: iconB64,
      appMeta: {
        name: appMeta.name,
        category: appMeta.category,
        rating: appMeta.rating,
        ratingCount: appMeta.ratingCount,
        platform,
        screenshotCount: appMeta.screenshotUrls?.length || 0,
      },
    });
  } catch (err) {
    console.error("AutoGen error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
