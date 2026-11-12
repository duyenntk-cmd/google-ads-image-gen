import { NextRequest, NextResponse } from "next/server";
import gplay from "google-play-scraper";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Map country display names -> ISO 3166-1 alpha-2 codes.
// Must cover every entry of COUNTRIES in app/page.tsx, otherwise the picker
// silently falls back to the US store and returns the wrong localized assets.
const COUNTRY_CODES: Record<string, string> = {
  global: "us",
  // Southeast Asia
  vietnam: "vn", "viet nam": "vn",
  indonesia: "id",
  thailand: "th",
  philippines: "ph",
  malaysia: "my",
  singapore: "sg",
  myanmar: "mm",
  cambodia: "kh",
  // East Asia
  japan: "jp",
  "south korea": "kr", korea: "kr",
  china: "cn",
  taiwan: "tw",
  "hong kong": "hk",
  // South Asia
  india: "in",
  pakistan: "pk",
  bangladesh: "bd",
  "sri lanka": "lk",
  // Middle East
  "saudi arabia": "sa",
  uae: "ae", "united arab emirates": "ae",
  egypt: "eg",
  turkey: "tr",
  israel: "il",
  iraq: "iq",
  // North America
  usa: "us", us: "us", "united states": "us",
  canada: "ca",
  mexico: "mx",
  // South America
  brazil: "br",
  argentina: "ar",
  colombia: "co",
  chile: "cl",
  peru: "pe",
  // Europe
  germany: "de",
  france: "fr",
  "united kingdom": "gb", uk: "gb",
  italy: "it",
  spain: "es",
  netherlands: "nl",
  poland: "pl",
  sweden: "se",
  norway: "no",
  denmark: "dk",
  finland: "fi",
  belgium: "be",
  switzerland: "ch",
  austria: "at",
  portugal: "pt",
  greece: "gr",
  ukraine: "ua",
  russia: "ru",
  // Oceania
  australia: "au",
  "new zealand": "nz",
  // Africa
  nigeria: "ng",
  "south africa": "za",
  kenya: "ke",
  ethiopia: "et",
  ghana: "gh",
};

/**
 * Language code for the store listing.
 *
 * The Play Store serves a localized listing — including localized screenshots —
 * per `lang`. That was pinned to "en", so switching to the Vietnam store still
 * returned the English screenshots, and the phone mockup showed an English
 * interface beside Vietnamese ad copy.
 */
const LANG_CODES: Record<string, string> = {
  vietnamese: "vi", english: "en", japanese: "ja", korean: "ko", thai: "th",
  indonesian: "id", "chinese simplified": "zh", arabic: "ar", spanish: "es",
  portuguese: "pt", russian: "ru", french: "fr", german: "de", hindi: "hi",
  bengali: "bn", filipino: "fil", malay: "ms",
};
function toLangCode(language?: string): string {
  if (!language) return "en";
  const l = language.trim().toLowerCase();
  if (/^[a-z]{2,3}$/.test(l)) return l;
  return LANG_CODES[l] || "en";
}

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
async function fetchIOS(appUrl: string, cc: string, shotLimit = 4, lang = "en") {
  const idMatch = appUrl.match(/id(\d+)/);
  if (!idMatch) throw new Error("Không tìm thấy App ID trong URL App Store.");
  const id = idMatch[1];
  const lookupUrl = `https://itunes.apple.com/lookup?id=${id}&country=${cc}&lang=${lang}_${cc}`;
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
    fetchImagesToDataUrls(shots, shotLimit),
  ]);

  return {
    appName: app.trackName as string,
    iconBase64,
    screenshots,
    platform: "ios" as const,
    description: String(app.description || "").slice(0, 1200),
    genre: app.primaryGenreName || "",
    rating: app.averageUserRating ?? null,
    developer: app.artistName || "",
    totalScreenshots: shots.length,
  };
}

/**
 * Reads the Play Store listing page directly.
 *
 * google-play-scraper parses that same page, so it breaks whenever Google
 * reshuffles the markup — which is how "Cannot read properties of undefined
 * (reading 'length')" reached the UI. This is deliberately cruder: it only
 * looks for the handful of things we need, using patterns that survive layout
 * changes, so a future break degrades to fewer screenshots rather than nothing.
 */
async function fetchAndroidFromHtml(appId: string, cc: string, lang = "en") {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=${lang}&gl=${cc.toUpperCase()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": `${lang},en;q=0.8`,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi đọc trang Play Store.`);
  const html = await res.text();

  const title =
    html.match(/<title>([^<]+?)\s*-\s*Apps on Google Play<\/title>/)?.[1] ||
    html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)?.[1] ||
    "";
  const description = (html.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1] || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .slice(0, 1200);
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] || "";

  // Every Play Store asset is served from this CDN. The icon is the og:image;
  // the rest, in document order, are the listing screenshots.
  const cdn = [...html.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/[A-Za-z0-9_\-]+/g)].map((m) => m[0]);
  const iconBase = ogImage.split("=")[0];
  const shots = [...new Set(cdn)].filter((u) => u !== iconBase);

  if (!title && !shots.length) throw new Error("Không đọc được nội dung trang Play Store (markup đã đổi?).");

  return {
    title,
    icon: ogImage,
    // Ask the CDN for a usable width; bare URLs come back tiny.
    screenshots: shots.map((u) => `${u}=w1280`),
    description,
  };
}

// --- Android Play Store: library first, direct HTML as the safety net ---
async function fetchAndroid(appUrl: string, cc: string, shotLimit = 4, lang = "en") {
  const idMatch = appUrl.match(/[?&]id=([^&]+)/);
  if (!idMatch) throw new Error("Không tìm thấy package id (?id=...) trong URL Play Store.");
  const appId = decodeURIComponent(idMatch[1]);

  let title = "";
  let iconUrl = "";
  let shotUrls: string[] = [];
  let description = "";
  let genre = "";
  let rating: number | null = null;
  let developer = "";
  let via = "scraper";
  let libError = "";

  try {
    const app = await (gplay as any).app({ appId, country: cc, lang });
    title = app.title || "";
    iconUrl = app.icon || "";
    shotUrls = app.screenshots || [];
    description = String(app.description || "").replace(/<[^>]+>/g, " ").slice(0, 1200);
    genre = app.genre || "";
    rating = app.score ?? null;
    developer = app.developer || "";
  } catch (e: any) {
    libError = String(e?.message || e);

    // Bot protection rejects the request outright; the fallback hits the same
    // endpoint from the same IP, so retrying it would only waste time.
    if (/403|forbidden/i.test(libError)) {
      throw new Error(
        `Google Play chặn request (403) cho "${appId}" ở store ${cc.toUpperCase()}. ` +
          `Thường do IP server bị bot-protection chặn, hoặc app không phát hành ở thị trường này. ` +
          `Thử đổi Thị trường, hoặc dùng link App Store (iOS) thay thế.`,
      );
    }

    try {
      const fb = await fetchAndroidFromHtml(appId, cc, lang);
      title = fb.title;
      iconUrl = fb.icon;
      shotUrls = fb.screenshots;
      description = fb.description;
      via = "html-fallback";
    } catch (e2: any) {
      if (/404|not found/i.test(libError)) {
        throw new Error(`Không tìm thấy app "${appId}" trên Play Store ${cc.toUpperCase()}. Kiểm tra lại package id / Thị trường.`);
      }
      throw new Error(
        `Không đọc được Play Store cho "${appId}" (${cc.toUpperCase()}). ` +
          `Thư viện lỗi: ${libError}. Đọc trực tiếp cũng lỗi: ${e2?.message || e2}`,
      );
    }
  }

  const [iconBase64, screenshots] = await Promise.all([
    iconUrl ? toDataUrl(iconUrl) : Promise.resolve(null),
    fetchImagesToDataUrls(shotUrls, shotLimit),
  ]);

  return {
    appName: title,
    iconBase64,
    screenshots,
    platform: "android" as const,
    description,
    genre,
    rating,
    developer,
    totalScreenshots: shotUrls.length,
    /** "scraper" or "html-fallback" — tells you which path produced this. */
    via,
    ...(libError && via === "html-fallback" ? { scraperError: libError } : {}),
  };
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { appUrl, country, limit, language } = await req.json();
    if (!appUrl || typeof appUrl !== "string") {
      return NextResponse.json({ success: false, error: "Thiếu appUrl." }, { status: 400 });
    }

    // Auto Prompt only needs a couple of images; downloading all 4 just to write
    // two sentences is what made that button slow enough to time out.
    const shotLimit = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(4, Number(limit))) : 4;

    const cc = toCountryCode(country);
    const lang = toLangCode(language);
    const isIOS = /apps\.apple\.com|itunes\.apple\.com/i.test(appUrl);
    const isAndroid = /play\.google\.com/i.test(appUrl);

    let result;
    if (isIOS) result = await fetchIOS(appUrl, cc, shotLimit, lang);
    else if (isAndroid) result = await fetchAndroid(appUrl, cc, shotLimit, lang);
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

    return NextResponse.json({ success: true, countryCode: cc, langCode: lang, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Lỗi không xác định khi fetch app." },
      { status: 500 },
    );
  }
}
