import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 20;

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

async function fetchIconFromUrl(url: string): Promise<{ iconDataUrl: string | null; appName: string | null }> {
  // iOS App Store
  const iosMatch = url.match(/apps\.apple\.com\/[^/]+\/app\/[^/]+\/id(\d+)/);
  if (iosMatch) {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${iosMatch[1]}`);
    const data = await res.json();
    const app = data.results?.[0];
    if (!app) return { iconDataUrl: null, appName: null };
    const iconUrl = app.artworkUrl512 || app.artworkUrl100 || "";
    const iconDataUrl = iconUrl ? await fetchImageAsBase64(iconUrl) : null;
    return { iconDataUrl, appName: app.trackName || null };
  }

  // Google Play Store
  const androidMatch = url.match(/play\.google\.com\/store\/apps\/details\?.*id=([\w.]+)/);
  if (androidMatch) {
    const pkg = androidMatch[1];
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
    const iconMatch = html.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)" [^>]*itemprop="image"/);
    const titleMatch = html.match(/<title>([^<]+) - Apps on Google Play<\/title>/);
    const name = titleMatch?.[1]?.trim() || null;
    const iconUrl = iconMatch?.[1] || "";
    const iconDataUrl = iconUrl ? await fetchImageAsBase64(iconUrl) : null;
    return { iconDataUrl, appName: name };
  }

  return { iconDataUrl: null, appName: null };
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ success: false, error: "Missing url" }, { status: 400 });
    const result = await fetchIconFromUrl(url);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
