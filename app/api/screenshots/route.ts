import { NextRequest, NextResponse } from "next/server";
import gplay from "google-play-scraper";

export const runtime = "nodejs";
export const maxDuration = 60;

// Map common country display names -> ISO 3166-1 alpha-2 codes.
const COUNTRY_CODES: Record<string, string> = {
  global: "us",
  vietnam: "vn",
  "viet nam": "vn",
  indonesia: "id",
  "united states": "us",
  usa: "us",
  us: "us",
  india: "in",
  thailand: "th",
  philippines: "ph",
  malaysia: "my",
  singapore: "sg",
  japan: "jp",
  korea: "kr",
  "south korea": "kr",
  brazil: "br",
  mexico: "mx",
};

function toCountryCode(country?: string): string {
  if (!country) return "us";
  const c = country.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(c)) return c; // already a 2-letter code
  return COUNTRY_CODES[c] || "us";
}

// Fetch a remote image and return a base64 data URL. Returns null on failure.
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BannerGen/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function fetchImagesToDataUrls(urls: string[], limit: number): Promise<string[]> {
  const picked = urls.filter(Boolean).slice(0, limit);
  const results = await Promise.all(picked.map((u) => toDataUrl(u)));
  return results.filter((x): x is string => Boolean(x));
}

// --- iOS App Store via iTunes Lookup API ---
async function fetchIOS(appUrl: string, cc: string) {
  const idMatch = appUrl.match(/id(\d+)/);
  if (!idMatch) throw new Error("Không tìm thấy App ID trong URL App Store.");
  const id = idMatch[1];
  const lookupUrl = `https://itunes.apple.com/lookup?id=${id}&country=${cc}`;
  const res = await fetch(lookupUrl);
  if (!res.ok) throw new Error(`iTunes lookup lỗi (HTTP ${res.status}).`);
  const data = await res.json();
  const app = data?.results?.[0];
  if (!app) throw new Error("App Store không trả về dữ liệu cho app này.");

  const iconUrl: string = app.artworkUrl512 || app.artworkUrl100 || app.artworkUrl60;
  const shots: string[] = [
    ...(app.screenshotUrls || []),
    ...(app.ipadScreenshotUrls || []),
  ];

  const [iconBase64, screenshots] = await Promise.all([
    iconUrl ? toDataUrl(iconUrl) : Promise.resolve(null),
    fetchImagesToDataUrls(shots, 4),
  ]);

  return { appName: app.trackName as string, iconBase64, screenshots };
}

// --- Android Play Store via google-play-scraper ---
async function fetchAndroid(appUrl: string, cc: string) {
  const idMatch = appUrl.match(/[?&]id=([^&]+)/);
  if (!idMatch) throw new Error("Không tìm thấy package id (?id=...) trong URL Play Store.");
  const appId = decodeURIComponent(idMatch[1]);

  const app = await (gplay as any).app({ appId, country: cc, lang: "en" });

  const [iconBase64, screenshots] = await Promise.all([
    app.icon ? toDataUrl(app.icon) : Promise.resolve(null),
    fetchImagesToDataUrls(app.screenshots || [], 4),
  ]);

  return { appName: app.title as string, iconBase64, screenshots };
}

export async function POST(req: NextRequest) {
  try {
    const { appUrl, country } = await req.json();
    if (!appUrl || typeof appUrl !== "string") {
      return NextResponse.json({ success: false, error: "Thiếu appUrl." }, { status: 400 });
    }

    const cc = toCountryCode(country);
    const isIOS = /apps\.apple\.com|itunes\.apple\.com/i.test(appUrl);
    const isAndroid = /play\.google\.com/i.test(appUrl);

    let result;
    if (isIOS) result = await fetchIOS(appUrl, cc);
    else if (isAndroid) result = await fetchAndroid(appUrl, cc);
    else
      return NextResponse.json(
        { success: false, error: "URL phải là App Store (apps.apple.com) hoặc Play Store (play.google.com)." },
        { status: 400 },
      );

    if (!result.screenshots.length && !result.iconBase64) {
      return NextResponse.json(
        { success: false, error: "Không lấy được ảnh nào từ store. Kiểm tra lại URL / quốc gia." },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Lỗi không xác định khi fetch app." },
      { status: 500 },
    );
  }
}
