import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/** Read image dimensions from raw bytes (PNG/JPEG/WebP header) */
function getImageDimensions(buf: ArrayBuffer): { w: number; h: number } | null {
  const v = new DataView(buf);
  if (v.byteLength > 24 && v.getUint32(0) === 0x89504e47) {
    return { w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (v.byteLength > 4 && v.getUint16(0) === 0xFFD8) {
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if ((marker & 0xFFF0) === 0xFFC0 && marker !== 0xFFC4 && marker !== 0xFFC8) {
        if (off + 9 < v.byteLength) return { h: v.getUint16(off + 5), w: v.getUint16(off + 7) };
      }
      off += 2 + len;
    }
  }
  return null;
}

async function fetchImageAsBase64(url: string, rejectNonPortrait = false): Promise<string | null> {
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
    if (rejectNonPortrait) {
      const dim = getImageDimensions(buf);
      if (dim) {
        if (dim.w >= dim.h) return null; // landscape or square → promo/icon
        if (dim.h / dim.w < 1.3) return null; // near-square
      }
    }
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const ct = res.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch { return null; }
}

const COUNTRY_LOCALE: Record<string, { itunes: string; hl: string; gl: string }> = {
  "Vietnam":      { itunes: "vn", hl: "vi",    gl: "VN" },
  "Indonesia":    { itunes: "id", hl: "id",    gl: "ID" },
  "Thailand":     { itunes: "th", hl: "th",    gl: "TH" },
  "Philippines":  { itunes: "ph", hl: "tl",    gl: "PH" },
  "Malaysia":     { itunes: "my", hl: "ms",    gl: "MY" },
  "Singapore":    { itunes: "sg", hl: "en",    gl: "SG" },
  "Myanmar":      { itunes: "mm", hl: "my",    gl: "MM" },
  "Cambodia":     { itunes: "kh", hl: "km",    gl: "KH" },
  "Japan":        { itunes: "jp", hl: "ja",    gl: "JP" },
  "South Korea":  { itunes: "kr", hl: "ko",    gl: "KR" },
  "China":        { itunes: "cn", hl: "zh-CN", gl: "CN" },
  "Taiwan":       { itunes: "tw", hl: "zh-TW", gl: "TW" },
  "Hong Kong":    { itunes: "hk", hl: "zh-HK", gl: "HK" },
  "India":        { itunes: "in", hl: "hi",    gl: "IN" },
  "Pakistan":     { itunes: "pk", hl: "ur",    gl: "PK" },
  "Bangladesh":   { itunes: "bd", hl: "bn",    gl: "BD" },
  "Saudi Arabia": { itunes: "sa", hl: "ar",    gl: "SA" },
  "UAE":          { itunes: "ae", hl: "ar",    gl: "AE" },
  "Egypt":        { itunes: "eg", hl: "ar",    gl: "EG" },
  "Turkey":       { itunes: "tr", hl: "tr",    gl: "TR" },
  "USA":          { itunes: "us", hl: "en",    gl: "US" },
  "Canada":       { itunes: "ca", hl: "en",    gl: "CA" },
  "Mexico":       { itunes: "mx", hl: "es",    gl: "MX" },
  "Brazil":       { itunes: "br", hl: "pt",    gl: "BR" },
  "UK":           { itunes: "gb", hl: "en-GB", gl: "GB" },
  "Germany":      { itunes: "de", hl: "de",    gl: "DE" },
  "France":       { itunes: "fr", hl: "fr",    gl: "FR" },
  "Italy":        { itunes: "it", hl: "it",    gl: "IT" },
  "Spain":        { itunes: "es", hl: "es",    gl: "ES" },
  "Russia":       { itunes: "ru", hl: "ru",    gl: "RU" },
  "Australia":    { itunes: "au", hl: "en-AU", gl: "AU" },
};
const DEFAULT_LOCALE = { itunes: "us", hl: "en", gl: "US" };
const MIN_B64_LEN = 20000;

export async function POST(req: NextRequest) {
  try {
    const { appUrl, country } = await req.json() as { appUrl: string; country?: string };
    if (!appUrl?.trim()) return NextResponse.json({ success: false, error: "Missing appUrl" }, { status: 400 });

    const url = appUrl.trim();
    let appName = "";
    let iconBase64: string | null = null;
    let screenshotsBase64: string[] = [];

    // ── iOS ────────────────────────────────────────────────────────────────────
    const iosMatch = url.match(/apps\.apple\.com\/(?:[a-z-]+\/)?app\/[^/]+\/id(\d+)/);
    if (iosMatch) {
      const locale = COUNTRY_LOCALE[country || ""] || DEFAULT_LOCALE;
      const tryFetch = async (cc: string) => {
        const r = await fetch(`https://itunes.apple.com/lookup?id=${iosMatch[1]}&country=${cc}&entity=software`);
        const d = await r.json(); return d.results?.[0] || null;
      };
      let app = await tryFetch(locale.itunes);
      if (!app && locale.itunes !== "us") app = await tryFetch("us");
      if (app) {
        appName = app.trackName;
        iconBase64 = await fetchImageAsBase64(app.artworkUrl512 || app.artworkUrl100 || "");
        const shots = (app.screenshotUrls || []).slice(0, 8) as string[];
        const fetched = await Promise.all(shots.map((u: string) => fetchImageAsBase64(u, true)));
        screenshotsBase64 = fetched.filter((s): s is string => !!s && s.length > MIN_B64_LEN);
      }
    }

    // ── Android ────────────────────────────────────────────────────────────────
    const androidMatch = url.match(/play\.google\.com\/store\/apps\/details\?.*id=([\w.]+)/);
    if (androidMatch) {
      const pkg = androidMatch[1];
      const locale = COUNTRY_LOCALE[country || ""] || DEFAULT_LOCALE;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(
        `https://play.google.com/store/apps/details?id=${pkg}&hl=${locale.hl}&gl=${locale.gl}`,
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": `${locale.hl},en;q=0.8` }, signal: controller.signal }
      );
      clearTimeout(timer);
      const html = res.ok ? await res.text() : "";
      const ogMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
      const titleMatch = html.match(/<title>([^<]+?)\s*[-–|]\s*(?:Apps on Google Play|Google Play|एप्लिकेशन|ऐप्लिकेशन)/);
      appName = ogMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || pkg.split(".").pop()?.replace(/_/g, " ") || pkg;
      const iconMatch = html.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"=]+)" [^>]*itemprop="image"/);
      const iconUrl = iconMatch?.[1] || "";
      iconBase64 = iconUrl ? await fetchImageAsBase64(iconUrl) : null;
      const allPlayLhUrls = [...html.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/([A-Za-z0-9_\-]{20,})[^\s"'\\]*/g)];
      const iconBase = iconUrl?.split("=")?.[0] || "";
      const seen = new Set<string>();
      const screenshotUrls: string[] = [];
      for (const m of allPlayLhUrls) {
        const full = m[0]; const base = full.split("=")[0];
        if (seen.has(base) || base === iconBase) continue;
        const sizeMatch = full.match(/=(?:w|s)(\d+)/);
        if (sizeMatch && parseInt(sizeMatch[1]) < 100) continue;
        seen.add(base);
        screenshotUrls.push(`${base}=w1080-h1920-rw`);
        if (screenshotUrls.length >= 8) break;
      }
      const fetched = await Promise.all(screenshotUrls.map(u => fetchImageAsBase64(u, true)));
      screenshotsBase64 = fetched.filter((s): s is string => !!s && s.length > MIN_B64_LEN);
    }

    if (!iosMatch && !androidMatch) {
      return NextResponse.json({ success: false, error: "URL không hợp lệ. Vui lòng dùng link App Store hoặc Play Store." }, { status: 400 });
    }

    return NextResponse.json({ success: true, appName, iconBase64, screenshots: screenshotsBase64 });
  } catch (err) {
    console.error("Screenshots error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
