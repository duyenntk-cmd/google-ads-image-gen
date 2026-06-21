import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { packageId } = await req.json();
    if (!packageId) return NextResponse.json({ name: null });

    const res = await fetch(`https://play.google.com/store/apps/details?id=${packageId}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
    });
    if (!res.ok) return NextResponse.json({ name: null });

    const html = await res.text();

    // App name appears in <title>APP NAME - Apps on Google Play</title>
    const titleMatch = html.match(/<title>([^<]+) - Apps on Google Play<\/title>/);
    if (titleMatch) return NextResponse.json({ name: titleMatch[1].trim() });

    // Fallback: og:title meta tag
    const ogMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (ogMatch) return NextResponse.json({ name: ogMatch[1].trim() });

    return NextResponse.json({ name: null });
  } catch {
    return NextResponse.json({ name: null });
  }
}
