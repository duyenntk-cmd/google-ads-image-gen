import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
    });
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

// Map country name → iTunes country code + Play Store hl/gl
const COUNTRY_LOCALE: Record<string, { itunes: string; hl: string; gl: string }> = {
  "Vietnam":        { itunes: "vn", hl: "vi",    gl: "VN" },
  "Indonesia":      { itunes: "id", hl: "id",    gl: "ID" },
  "Thailand":       { itunes: "th", hl: "th",    gl: "TH" },
  "Philippines":    { itunes: "ph", hl: "tl",    gl: "PH" },
  "Malaysia":       { itunes: "my", hl: "ms",    gl: "MY" },
  "Singapore":      { itunes: "sg", hl: "en",    gl: "SG" },
  "Myanmar":        { itunes: "mm", hl: "my",    gl: "MM" },
  "Cambodia":       { itunes: "kh", hl: "km",    gl: "KH" },
  "Japan":          { itunes: "jp", hl: "ja",    gl: "JP" },
  "South Korea":    { itunes: "kr", hl: "ko",    gl: "KR" },
  "China":          { itunes: "cn", hl: "zh-CN", gl: "CN" },
  "Taiwan":         { itunes: "tw", hl: "zh-TW", gl: "TW" },
  "Hong Kong":      { itunes: "hk", hl: "zh-HK", gl: "HK" },
  "India":          { itunes: "in", hl: "hi",    gl: "IN" },
  "Pakistan":       { itunes: "pk", hl: "ur",    gl: "PK" },
  "Bangladesh":     { itunes: "bd", hl: "bn",    gl: "BD" },
  "Sri Lanka":      { itunes: "lk", hl: "si",    gl: "LK" },
  "Saudi Arabia":   { itunes: "sa", hl: "ar",    gl: "SA" },
  "UAE":            { itunes: "ae", hl: "ar",    gl: "AE" },
  "Egypt":          { itunes: "eg", hl: "ar",    gl: "EG" },
  "Turkey":         { itunes: "tr", hl: "tr",    gl: "TR" },
  "Israel":         { itunes: "il", hl: "he",    gl: "IL" },
  "Iraq":           { itunes: "iq", hl: "ar",    gl: "IQ" },
  "USA":            { itunes: "us", hl: "en",    gl: "US" },
  "Canada":         { itunes: "ca", hl: "en",    gl: "CA" },
  "Mexico":         { itunes: "mx", hl: "es",    gl: "MX" },
  "Brazil":         { itunes: "br", hl: "pt-BR", gl: "BR" },
  "Argentina":      { itunes: "ar", hl: "es",    gl: "AR" },
  "Colombia":       { itunes: "co", hl: "es",    gl: "CO" },
  "Chile":          { itunes: "cl", hl: "es",    gl: "CL" },
  "Peru":           { itunes: "pe", hl: "es",    gl: "PE" },
  "Germany":        { itunes: "de", hl: "de",    gl: "DE" },
  "France":         { itunes: "fr", hl: "fr",    gl: "FR" },
  "United Kingdom": { itunes: "gb", hl: "en-GB", gl: "GB" },
  "Italy":          { itunes: "it", hl: "it",    gl: "IT" },
  "Spain":          { itunes: "es", hl: "es",    gl: "ES" },
  "Netherlands":    { itunes: "nl", hl: "nl",    gl: "NL" },
  "Poland":         { itunes: "pl", hl: "pl",    gl: "PL" },
  "Russia":         { itunes: "ru", hl: "ru",    gl: "RU" },
  "Australia":      { itunes: "au", hl: "en-AU", gl: "AU" },
  "Nigeria":        { itunes: "ng", hl: "en",    gl: "NG" },
  "South Africa":   { itunes: "za", hl: "en",    gl: "ZA" },
};
const DEFAULT_LOCALE = { itunes: "us", hl: "en", gl: "US" };

async function fetchIosData(id: string, country = "Global") {
  const locale = COUNTRY_LOCALE[country] || DEFAULT_LOCALE;
  // Try localized first, fallback to US if no results
  const tryFetch = async (cc: string) => {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${cc}&entity=software`);
    const data = await res.json();
    return data.results?.[0] || null;
  };
  let app = await tryFetch(locale.itunes);
  if (!app && locale.itunes !== "us") app = await tryFetch("us");
  if (!app) return null;
  // Phone screenshots only — ipadScreenshotUrls often includes ESRB/rating badges
  const allScreenshots: string[] = (app.screenshotUrls || []).slice(0, 6);
  return {
    name: app.trackName as string,
    description: ((app.description as string) || "").slice(0, 500),
    category: (app.primaryGenreName as string) || "",
    iconUrl: (app.artworkUrl512 || app.artworkUrl100 || "") as string,
    screenshotUrls: allScreenshots,
    rating: (app.averageUserRating || 0) as number,
    ratingCount: (app.userRatingCount || 0) as number,
    platform: "iOS",
    locale,
  };
}

async function fetchAndroidData(pkg: string, country = "Global") {
  const locale = COUNTRY_LOCALE[country] || DEFAULT_LOCALE;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(
      `https://play.google.com/store/apps/details?id=${pkg}&hl=${locale.hl}&gl=${locale.gl}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": `${locale.hl},en;q=0.8`,
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    const html = res.ok ? await res.text() : "";

    const titleMatch = html.match(/<title>([^<]+) - Apps on Google Play<\/title>/);
    const ogMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    const name = titleMatch?.[1]?.trim() || ogMatch?.[1]?.trim() || pkg.split(".").pop()?.replace(/_/g, " ") || pkg;

    // Extract icon URL
    const iconMatch = html.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"=]+)" [^>]*itemprop="image"/);
    const iconUrl = iconMatch?.[1] || "";

    // Extract screenshot URLs — Play Store embeds them as play-lh.googleusercontent.com images
    const screenshotMatches = [...html.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/[A-Za-z0-9_\-]+=w\d+/g)];
    // Filter unique, skip icon-sized, take up to 5
    const seen = new Set<string>();
    const screenshotUrls: string[] = [];
    for (const m of screenshotMatches) {
      const base = m[0].split("=")[0];
      if (!seen.has(base) && base !== iconUrl?.split("=")?.[0]) {
        seen.add(base);
        // Force high resolution
        screenshotUrls.push(`${base}=w1080`);
        if (screenshotUrls.length >= 5) break;
      }
    }

    // Try description from og:description
    const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
    const description = (descMatch?.[1] || "").slice(0, 500);

    return {
      name,
      description,
      category: "",
      iconUrl,
      screenshotUrls,
      rating: 0,
      ratingCount: 0,
      platform: "Android",
      locale,
    };
  } catch {
    const name = pkg.split(".").pop()?.replace(/_/g, " ") || pkg;
    return { name, description: "", category: "", iconUrl: "", screenshotUrls: [] as string[], rating: 0, ratingCount: 0, platform: "Android", locale: DEFAULT_LOCALE };
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
      appMeta = await fetchIosData(iosMatch[1], country);
    } else if (androidMatch) {
      appMeta = await fetchAndroidData(androidMatch[1], country);
    }

    if (!appMeta) {
      return NextResponse.json({ success: false, error: "Không thể lấy thông tin app. Kiểm tra lại URL App Store hoặc Play Store." }, { status: 400 });
    }

    // Fetch all screenshots + icon in parallel (up to 5 screenshots)
    const screenshotUrls = appMeta.screenshotUrls.slice(0, 6);
    const [screenshotsResults, iconB64] = await Promise.all([
      Promise.all(screenshotUrls.map(u => fetchImageAsBase64(u))),
      appMeta.iconUrl ? fetchImageAsBase64(appMeta.iconUrl) : Promise.resolve(null),
    ]);
    // Filter out null and tiny images (badges/logos are usually < 15KB = ~20000 base64 chars)
    const MIN_B64_LEN = 20000;
    const screenshotsB64 = screenshotsResults.filter(
      (s): s is string => s !== null && s.length > MIN_B64_LEN
    ).slice(0, 5);

    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const kwCtx = keywords?.trim() ? `Key selling points / keywords: ${keywords}` : "";
    const ratingCtx = appMeta.rating ? `App rating: ${appMeta.rating.toFixed(1)}/5 (${appMeta.ratingCount.toLocaleString()} ratings).` : "";
    const langOut = language || "English";

    // Build image blocks for Claude — send all screenshots for richer analysis
    const userContent: Anthropic.ContentBlockParam[] = [];
    for (const s of screenshotsB64) {
      const rawB64 = s.split(",")[1] || s;
      const mtype: "image/jpeg" | "image/png" = s.includes("image/png") ? "image/png" : "image/jpeg";
      userContent.push({ type: "image", source: { type: "base64", media_type: mtype, data: rawB64 } });
    }

    const promptText = `You are a Google Ads creative director for mobile apps.

App: ${appMeta.name}
Platform: ${appMeta.platform}
Category: ${appMeta.category || niche || "App"}
${ratingCtx}
${kwCtx}
Description: ${appMeta.description}
${marketCtx}
Language for ad copy: ${langOut}
${screenshotsB64.length > 0 ? `${screenshotsB64.length} app screenshot(s) provided above. Analyze them for dominant colors, visual style, mood, and which screenshot would make the best ad background (most visually striking, clearest subject, not cluttered).` : "No screenshots available."}

Generate a complete Google Ads creative brief. Return ONLY valid JSON, no markdown:
{
  "app_name": "${appMeta.name}",
  "headline": "punchy headline MAX 30 chars in ${langOut}",
  "subheadline": "supporting line MAX 50 chars in ${langOut}",
  "cta_text": "CTA MAX 12 chars in ${langOut}",
  "primary_color": "#hexcode — dominant background/brand color from screenshots",
  "secondary_color": "#hexcode",
  "accent_color": "#hexcode — high-contrast CTA color",
  "background_style": "dark|light|gradient",
  "mood": "bold|minimal|professional|playful|vibrant",
  "layout_suggestion": "lifestyle|product|minimal|bold",
  "best_frame_index": <0-based index of best screenshot for ads, 0 if unsure>,
  "subject_position": "top|center|bottom|left|right|top-left|top-right|bottom-left|bottom-right",
  "text_zone": "bottom|top|left|right",
  "niche": "${niche || "photo"}",
  "app_store_url": "${appMeta.platform === "iOS" ? url : ""}",
  "play_store_url": "${appMeta.platform === "Android" ? url : ""}"
}`;

    userContent.push({ type: "text", text: promptText });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude did not return valid JSON");

    const brief = JSON.parse(jsonMatch[0]);
    // Enforce char limits
    if (brief.headline) brief.headline = brief.headline.slice(0, 30);
    if (brief.subheadline) brief.subheadline = brief.subheadline.slice(0, 50);
    if (brief.cta_text) brief.cta_text = brief.cta_text.slice(0, 12);

    return NextResponse.json({
      success: true,
      brief,
      screenshotsBase64: screenshotsB64,       // array of all screenshots
      screenshotBase64: screenshotsB64[0] || null, // backward compat
      iconBase64: iconB64 || null,
      appMeta: {
        name: appMeta.name,
        category: appMeta.category,
        rating: appMeta.rating,
        ratingCount: appMeta.ratingCount,
        platform: appMeta.platform,
        screenshotCount: screenshotsB64.length,
      },
    });
  } catch (err) {
    console.error("AutoGen error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
