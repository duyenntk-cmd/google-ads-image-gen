import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 45;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const ct = res.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

async function fetchIosData(id: string) {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${id}`);
  const data = await res.json();
  const app = data.results?.[0];
  if (!app) return null;
  return {
    name: app.trackName as string,
    description: ((app.description as string) || "").slice(0, 500),
    category: (app.primaryGenreName as string) || "",
    iconUrl: (app.artworkUrl512 || app.artworkUrl100 || "") as string,
    screenshotUrls: (app.screenshotUrls || []) as string[],
    rating: (app.averageUserRating || 0) as number,
    ratingCount: (app.userRatingCount || 0) as number,
    platform: "iOS",
  };
}

async function fetchAndroidData(pkg: string) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://play.google.com/store/apps/details?id=${pkg}&hl=en`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    const html = res.ok ? await res.text() : "";
    const titleMatch = html.match(/<title>([^<]+) - Apps on Google Play<\/title>/);
    const ogMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    const iconMatch = html.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)" [^>]*itemprop="image"/);
    const name = titleMatch?.[1]?.trim() || ogMatch?.[1]?.trim() || pkg.split(".").pop()?.replace(/_/g, " ") || pkg;
    return {
      name,
      description: "",
      category: "",
      iconUrl: iconMatch?.[1] || "",
      screenshotUrls: [] as string[],
      rating: 0,
      ratingCount: 0,
      platform: "Android",
    };
  } catch {
    const name = pkg.split(".").pop()?.replace(/_/g, " ") || pkg;
    return { name, description: "", category: "", iconUrl: "", screenshotUrls: [] as string[], rating: 0, ratingCount: 0, platform: "Android" };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { appUrl, keywords, country, language, niche } = body as {
      appUrl: string; keywords?: string; country?: string; language?: string; niche?: string;
    };

    if (!appUrl?.trim()) {
      return NextResponse.json({ success: false, error: "Missing appUrl" }, { status: 400 });
    }

    const url = appUrl.trim();
    const iosMatch = url.match(/apps\.apple\.com\/[^/]+\/app\/[^/]+\/id(\d+)/) || url.match(/apps\.apple\.com.*\/id(\d+)/);
    const androidMatch = url.match(/[?&]id=([a-zA-Z0-9._]+)/);

    let appMeta: { name: string; description: string; category: string; iconUrl: string; screenshotUrls: string[]; rating: number; ratingCount: number; platform: string; } | null = null;

    if (iosMatch) {
      appMeta = await fetchIosData(iosMatch[1]);
    } else if (androidMatch) {
      appMeta = await fetchAndroidData(androidMatch[1]);
    }

    if (!appMeta) {
      return NextResponse.json({ success: false, error: "Không thể lấy thông tin app. Kiểm tra lại URL App Store hoặc Play Store." }, { status: 400 });
    }

    // Fetch screenshot + icon in parallel
    const [screenshotB64, iconB64] = await Promise.all([
      appMeta.screenshotUrls?.[0] ? fetchImageAsBase64(appMeta.screenshotUrls[0]) : Promise.resolve(null),
      appMeta.iconUrl ? fetchImageAsBase64(appMeta.iconUrl) : Promise.resolve(null),
    ]);

    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const kwCtx = keywords?.trim() ? `Key selling points / keywords: ${keywords}` : "";
    const ratingCtx = appMeta.rating ? `App rating: ${appMeta.rating.toFixed(1)}/5 (${appMeta.ratingCount.toLocaleString()} ratings).` : "";
    const langOut = language || "English";

    // Build prompt text
    const promptText = `You are a Google Ads creative director for mobile apps.

App: ${appMeta.name}
Platform: ${appMeta.platform}
Category: ${appMeta.category || niche || "App"}
${ratingCtx}
${kwCtx}
Description: ${appMeta.description}
${marketCtx}
Language for ad copy: ${langOut}
${screenshotB64 ? "An app screenshot was provided above — analyze its colors and visual style." : "No screenshot available."}

Generate a complete Google Ads creative brief. Return ONLY valid JSON:
{
  "app_name": "${appMeta.name}",
  "headline": "punchy headline MAX 30 chars in ${langOut}",
  "subheadline": "supporting line MAX 50 chars in ${langOut}",
  "cta_text": "CTA MAX 12 chars in ${langOut}",
  "primary_color": "#hexcode",
  "secondary_color": "#hexcode",
  "accent_color": "#hexcode",
  "background_style": "dark",
  "mood": "bold",
  "best_frame_index": 0,
  "niche": "${niche || "photo"}",
  "app_store_url": "${appMeta.platform === "iOS" ? url : ""}",
  "play_store_url": "${appMeta.platform === "Android" ? url : ""}"
}`;

    // Build messages — include screenshot if available
    const userContent: Anthropic.ContentBlockParam[] = [];
    if (screenshotB64) {
      const rawB64 = screenshotB64.split(",")[1] || screenshotB64;
      const mtype: "image/jpeg" | "image/png" = screenshotB64.includes("image/png") ? "image/png" : "image/jpeg";
      userContent.push({ type: "image", source: { type: "base64", media_type: mtype, data: rawB64 } });
    }
    userContent.push({ type: "text", text: promptText });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude did not return valid JSON");

    const brief = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      success: true,
      brief,
      screenshotBase64: screenshotB64 || null,
      iconBase64: iconB64 || null,
      appMeta: {
        name: appMeta.name,
        category: appMeta.category,
        rating: appMeta.rating,
        ratingCount: appMeta.ratingCount,
        platform: appMeta.platform,
        screenshotCount: appMeta.screenshotUrls?.length || 0,
      },
    });
  } catch (err) {
    console.error("AutoGen error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
