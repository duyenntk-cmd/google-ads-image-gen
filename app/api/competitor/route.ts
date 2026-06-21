import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const ST_BASE = "https://api.sensortower.com/v1";
const AUTH = process.env.SENSORTOWER_API_KEY || "";

function extractAppId(url: string): { os: "ios" | "android"; id: string } | null {
  // App Store: https://apps.apple.com/us/app/name/id123456789
  const iosMatch = url.match(/apps\.apple\.com.*?\/id(\d+)/);
  if (iosMatch) return { os: "ios", id: iosMatch[1] };
  // Play Store: https://play.google.com/store/apps/details?id=com.example.app
  const androidMatch = url.match(/play\.google\.com.*?id=([a-zA-Z0-9._]+)/);
  if (androidMatch) return { os: "android", id: androidMatch[1] };
  return null;
}

async function stFetch(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${ST_BASE}${path}${sep}auth_token=${AUTH}`);
  if (!res.ok) throw new Error(`SensorTower error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    if (!AUTH) return NextResponse.json({ success: false, error: "SENSORTOWER_API_KEY not configured" }, { status: 500 });

    const { query } = await req.json();
    if (!query) return NextResponse.json({ success: false, error: "Missing query" }, { status: 400 });

    // Detect if input is a URL or a search term
    const parsed = extractAppId(query);
    let appId: string;
    let os: "ios" | "android";

    if (parsed) {
      appId = parsed.id;
      os = parsed.os;
    } else {
      // Search by name — try ios first
      const searchRes = await stFetch(`/ios/apps/search?search_term=${encodeURIComponent(query)}&limit=1`);
      const app = searchRes?.apps?.[0];
      if (!app) return NextResponse.json({ success: false, error: "App not found" }, { status: 404 });
      appId = app.app_id || app.id;
      os = "ios";
    }

    const today = new Date();
    const end = today.toISOString().split("T")[0];
    const start = new Date(today.setMonth(today.getMonth() - 3)).toISOString().split("T")[0];

    // Fetch in parallel: app details + ad creatives + network analysis
    const [detailsRes, creativesRes, networkRes] = await Promise.allSettled([
      stFetch(`/${os}/apps/${appId}`),
      stFetch(`/${os}/ad_intel/creatives?app_ids=${appId}&start_date=${start}&end_date=${end}&limit=20`),
      stFetch(`/${os}/ad_intel/share_of_voice?app_ids=${appId}&start_date=${start}&end_date=${end}&date_granularity=monthly`),
    ]);

    const details = detailsRes.status === "fulfilled" ? detailsRes.value : null;
    const creatives = creativesRes.status === "fulfilled" ? creativesRes.value : null;
    const network = networkRes.status === "fulfilled" ? networkRes.value : null;

    return NextResponse.json({ success: true, appId, os, details, creatives, network });
  } catch (err) {
    console.error("Competitor error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
