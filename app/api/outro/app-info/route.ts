import { NextRequest, NextResponse } from "next/server";

// Outro Studio: lấy tên app, icon (data URL) và headline từ link App Store / Google Play
// để tự điền end card. Gọi từ public/outro-studio/index.html.

export const maxDuration = 30;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function json(obj: unknown, status = 200) {
  return NextResponse.json(obj, {
    status,
    headers: { "cache-control": status === 200 ? "private, max-age=3600" : "no-store" },
  });
}

function decode(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .trim();
}

// "AI Mirror: AI Photo Editor" -> ["AI Mirror", "AI Photo Editor"]
function splitName(full: string): [string, string] {
  const m = full.match(/^(.{2,40}?)\s*(?::|\s[-–—|])\s+(.+)$/);
  return m ? [m[1].trim(), m[2].trim()] : [full.trim(), ""];
}

function firstSentence(text?: string) {
  const d = (text || "").replace(/\s+/g, " ").trim();
  const m = d.match(/^(.{10,90}?[.!?])(\s|$)/);
  if (m) return m[1];
  return d.length > 80 ? d.slice(0, 80).replace(/\s+\S*$/, "") + "…" : d;
}

async function iconData(src?: string | null) {
  if (!src) return null;
  const r = await fetch(src, { headers: { "user-agent": UA } });
  if (!r.ok) return null;
  const type = (r.headers.get("content-type") || "image/png").split(";")[0];
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${type};base64,${buf.toString("base64")}`;
}

async function appStore(url: URL) {
  const id = (url.pathname.match(/id(\d+)/) || [])[1];
  if (!id) return json({ error: "Không thấy mã app (dạng id123456789) trong link App Store." }, 400);
  const cc = ((url.pathname.match(/^\/([a-z]{2})\//i) || [])[1] || "us").toLowerCase();
  const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${cc}`, { headers: { "user-agent": UA } });
  const data = await r.json();
  const app = data.results && data.results[0];
  if (!app) return json({ error: `Không tìm thấy app này trên App Store khu vực ${cc.toUpperCase()}.` }, 404);
  // subtitle không có trong API, đọc từ trang app
  let subtitle = "";
  try {
    const html = await (await fetch(`https://apps.apple.com/${cc}/app/id${id}`, { headers: { "user-agent": UA } })).text();
    const m = html.match(/class="[^"]*subtitle[^"]*"[^>]*>\s*([^<]{2,120}?)\s*</);
    if (m) subtitle = decode(m[1]);
  } catch {}
  const [name, rest] = splitName(app.trackName || "");
  return json({
    store: "ios",
    fullName: app.trackName,
    name,
    headline: subtitle || rest || firstSentence(app.description),
    icon: await iconData(app.artworkUrl512 || app.artworkUrl100),
  });
}

async function googlePlay(url: URL) {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Không thấy mã app (id=com.xxx) trong link Google Play." }, 400);
  const hl = url.searchParams.get("hl") || "en";
  const gl = url.searchParams.get("gl") || "us";
  const r = await fetch(
    `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}`,
    { headers: { "user-agent": UA, "accept-language": hl } },
  );
  if (r.status === 404) return json({ error: "Không tìm thấy app này trên Google Play." }, 404);
  const html = await r.text();
  const meta = (p: string) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)="${p}"[^>]+content="([^"]*)"`, "i")) ||
      html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name|itemprop)="${p}"`, "i"));
    return m ? decode(m[1]) : "";
  };
  let full = (html.match(/<h1[^>]*itemprop="name"[^>]*>(?:\s*<span[^>]*>)?([^<]+)/) || [])[1];
  full = full ? decode(full) : meta("og:title").replace(/\s+[-–]\s+[^-–]*Google Play.*$/i, "");
  if (!full) return json({ error: "Không đọc được trang Google Play của app này." }, 502);
  let icon = (html.match(/<img[^>]+src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"[^>]*itemprop="image"/) ||
    html.match(/<img[^>]+itemprop="image"[^>]+src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/) || [])[1] || meta("og:image");
  if (icon) icon = decode(icon).replace(/=[^=/]*$/, "") + "=s512";
  const [name, rest] = splitName(full);
  return json({
    store: "android",
    fullName: full,
    name,
    headline: rest || firstSentence(meta("description") || meta("og:description")),
    icon: await iconData(icon),
  });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") || "";
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return json({ error: "Link không hợp lệ. Dán link đầy đủ bắt đầu bằng https://" }, 400); }
  try {
    if (/(^|\.)apps\.apple\.com$|^itunes\.apple\.com$/.test(url.hostname)) return await appStore(url);
    if (url.hostname === "play.google.com") return await googlePlay(url);
    return json({ error: "Chỉ hỗ trợ link App Store (apps.apple.com) hoặc Google Play (play.google.com)." }, 400);
  } catch (e) {
    return json({ error: "Không lấy được thông tin app: " + (e instanceof Error ? e.message : String(e)) }, 502);
  }
}
