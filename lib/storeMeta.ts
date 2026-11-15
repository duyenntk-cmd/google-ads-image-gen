/**
 * App facts from an App Store / Google Play link, for writing ad copy:
 * name, developer, category, description, rating. No images — this is what a
 * copywriter needs, and it keeps the call fast.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface StoreMeta {
  store: "ios" | "android";
  url: string;
  id: string;
  name: string;
  fullName: string;
  developer: string;
  category: string;
  rating: number | null;
  ratingCount: number | null;
  description: string;
}

function decode(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .trim();
}

// "AI Mirror: AI Photo Editor" -> "AI Mirror"
function shortName(full: string): string {
  const m = full.match(/^(.{2,40}?)\s*(?::|\s[-–—|])\s+(.+)$/);
  return (m ? m[1] : full).trim();
}

const clip = (s: string, n = 1500) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

async function appStore(url: URL): Promise<StoreMeta> {
  const id = (url.pathname.match(/id(\d+)/) || [])[1];
  if (!id) throw new Error("Không thấy mã app (dạng id123456789) trong link App Store.");
  const cc = ((url.pathname.match(/^\/([a-z]{2})\//i) || [])[1] || "us").toLowerCase();
  const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${cc}`, { headers: { "user-agent": UA } });
  const app = (await r.json())?.results?.[0];
  if (!app) throw new Error(`Không tìm thấy app này trên App Store khu vực ${cc.toUpperCase()}.`);
  return {
    store: "ios",
    url: url.toString(),
    id,
    fullName: app.trackName || "",
    name: shortName(app.trackName || ""),
    developer: app.sellerName || app.artistName || "",
    category: app.primaryGenreName || "",
    rating: typeof app.averageUserRating === "number" ? Math.round(app.averageUserRating * 10) / 10 : null,
    ratingCount: typeof app.userRatingCount === "number" ? app.userRatingCount : null,
    description: clip(String(app.description || "")),
  };
}

async function googlePlay(url: URL): Promise<StoreMeta> {
  const id = url.searchParams.get("id");
  if (!id) throw new Error("Không thấy mã app (id=com.xxx) trong link Google Play.");
  const hl = url.searchParams.get("hl") || "en";
  const gl = url.searchParams.get("gl") || "us";
  const r = await fetch(
    `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}`,
    { headers: { "user-agent": UA, "accept-language": hl } },
  );
  if (r.status === 404) throw new Error("Không tìm thấy app này trên Google Play.");
  const html = await r.text();
  const meta = (p: string) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)="${p}"[^>]+content="([^"]*)"`, "i")) ||
      html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name|itemprop)="${p}"`, "i"));
    return m ? decode(m[1]) : "";
  };
  // Play embeds a SoftwareApplication JSON-LD block with most of what we need.
  let ld: Record<string, unknown> = {};
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j && (j["@type"] === "SoftwareApplication" || j.applicationCategory)) { ld = j; break; }
    } catch { /* not JSON */ }
  }
  const author = ld.author as { name?: string } | undefined;
  const rating = ld.aggregateRating as { ratingValue?: string | number; ratingCount?: string | number } | undefined;
  let full = String(ld.name || "") || (html.match(/<h1[^>]*itemprop="name"[^>]*>(?:\s*<span[^>]*>)?([^<]+)/) || [])[1] || "";
  full = full ? decode(full) : meta("og:title").replace(/\s+[-–]\s+[^-–]*Google Play.*$/i, "");
  if (!full) throw new Error("Không đọc được trang Google Play của app này.");
  return {
    store: "android",
    url: url.toString(),
    id,
    fullName: full,
    name: shortName(full),
    developer: author?.name ? decode(author.name) : "",
    category: String(ld.applicationCategory || "").replace(/_/g, " ").toLowerCase(),
    rating: rating?.ratingValue != null ? Math.round(Number(rating.ratingValue) * 10) / 10 : null,
    ratingCount: rating?.ratingCount != null ? Number(rating.ratingCount) : null,
    description: clip(decode(String(ld.description || meta("description") || meta("og:description") || ""))),
  };
}

export async function getStoreMeta(raw: string): Promise<StoreMeta> {
  let url: URL;
  try { url = new URL(String(raw || "").trim()); } catch { throw new Error("Link không hợp lệ. Dán link đầy đủ bắt đầu bằng https://"); }
  const ios = /(^|\.)apps\.apple\.com$|^itunes\.apple\.com$/.test(url.hostname);
  if (!ios && url.hostname !== "play.google.com") throw new Error("Link phải là App Store (apps.apple.com) hoặc Google Play (play.google.com).");
  try {
    return await (ios ? appStore(url) : googlePlay(url));
  } catch (e) {
    // fetch() itself failing (DNS, timeout, blocked) says only "fetch failed"
    if (e instanceof TypeError) throw new Error(`Không tải được trang ${ios ? "App Store" : "Google Play"} lúc này, thử lại sau.`);
    throw e;
  }
}
