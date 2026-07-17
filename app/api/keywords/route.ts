import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function lookupAppMeta(url: string): Promise<string> {
  const iosMatch = url.match(/apps\.apple\.com\/[^/]+\/app\/([^/]+)\/id(\d+)/);
  const iosIdOnly = url.match(/apps\.apple\.com.*\/id(\d+)/);
  const androidMatch = url.match(/id=([a-zA-Z0-9._]+)/);

  if (iosMatch || iosIdOnly) {
    const id = (iosMatch?.[2] || iosIdOnly?.[1]);
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${id}`);
      const data = await res.json();
      const app = data.results?.[0];
      if (app) {
        return `App name: ${app.trackName}. Category: ${app.primaryGenreName}. Description: ${app.description?.slice(0, 300)}`;
      }
    } catch { /* fallback */ }
  }

  if (androidMatch) {
    const pkg = androidMatch[1];
    const parts = pkg.split(".");
    return `App package: ${pkg}. App name hint: ${parts[parts.length - 1].replace(/_/g, " ")}`;
  }

  return `App: ${url}`;
}

export async function POST(req: NextRequest) {
  try {
    const { appName, appUrl, country, language } = await req.json();

    let appContext = appName || "";
    if (appUrl?.trim().startsWith("http")) {
      const meta = await lookupAppMeta(appUrl.trim());
      appContext = meta;
    } else if (appName) {
      appContext = `App name: ${appName}`;
    }

    if (!appContext) {
      return NextResponse.json({ success: false, error: "Missing app info" }, { status: 400 });
    }

    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";

    const prompt = `You are a Google Ads keyword research expert specializing in mobile app user acquisition.

App info: ${appContext}
${marketCtx}
Language context: ${language || "English"}

Generate exactly 20 high-quality Google Ads keywords for this mobile app. Return ONLY valid JSON, no markdown:
{
  "app_name": "detected app name",
  "keywords": [
    {
      "keyword": "keyword phrase",
      "monthly_searches": "10K-100K",
      "competition": "Low|Medium|High",
      "competition_index": 45,
      "cpc_min": 0.30,
      "cpc_max": 1.20,
      "relevance": 95,
      "intent": "Install|Explore|Compare|Branded"
    }
  ]
}

Rules:
- Mix of: branded (app name variants), category, feature-based, competitor, problem-solution keywords
- monthly_searches: use ranges like "1K-10K", "10K-100K", "100K-1M", "1M+"
- competition_index: 0-100 (0=lowest, 100=highest)
- cpc_min/cpc_max: realistic USD CPC for ${country || "global"} market
- relevance: 0-100 (how relevant to this specific app)
- intent: Install (ready to download), Explore (researching), Compare (vs alternatives), Branded (app name based)
- Keywords should be in English unless the market strongly prefers local language
- Make them realistic and actionable for Google UAC / App campaigns`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const result = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error("Keywords error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
