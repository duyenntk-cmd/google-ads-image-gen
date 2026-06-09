import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { AD_SIZES } from "@/lib/adSizes";
import JSZip from "jszip";
import path from "path";
import fs from "fs";

export const maxDuration = 60;

interface Brief {
  app_name?: string; headline?: string; subheadline?: string; cta_text?: string;
  primary_color?: string; secondary_color?: string; accent_color?: string;
  background_style?: string; mood?: string; best_frame_index?: number;
  niche?: string; app_store_url?: string; play_store_url?: string;
}

const NICHE_DEFAULTS: Record<string, Partial<Brief>> = {
  photo:  { primary_color:"#7B2FBE", secondary_color:"#E91E8C", accent_color:"#FF6B35", headline:"Edit Photos Like a Pro",      subheadline:"100+ Filters & AI Tools",   cta_text:"Edit for Free",    background_style:"dark"  },
  tool:   { primary_color:"#2563EB", secondary_color:"#60A5FA", accent_color:"#059669", headline:"Get More Done in Less Time", subheadline:"Smart tools for every task", cta_text:"Try Free",         background_style:"light" },
  office: { primary_color:"#1E3A5F", secondary_color:"#2563EB", accent_color:"#3B82F6", headline:"Work Smarter with Your Team",subheadline:"Documents, Sheets & More",   cta_text:"Start Free Trial", background_style:"light" },
};

// Load fonts from bundled files
let fontBase64Cache: string | null = null;
let fontBoldBase64Cache: string | null = null;

function getFontBase64(bold = false): string {
  if (bold && fontBoldBase64Cache) return fontBoldBase64Cache;
  if (!bold && fontBase64Cache) return fontBase64Cache;

  const filename = bold ? "inter-bold.woff2" : "inter-regular.woff2";
  const fontPath = path.join(process.cwd(), "public", "fonts", filename);
  const b64 = fs.readFileSync(fontPath).toString("base64");

  if (bold) fontBoldBase64Cache = b64;
  else fontBase64Cache = b64;
  return b64;
}

function lighten(hex: string, f = 1.3): string {
  const h = hex.replace("#", "");
  const rgb = [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  return "#" + rgb.map(c => Math.min(255, Math.round(c * f)).toString(16).padStart(2,"0")).join("");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, charsPerLine: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if ((cur + " " + word).trim().length > charsPerLine) {
      if (cur) lines.push(cur);
      cur = word;
    } else { cur = (cur + " " + word).trim(); }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function buildSVG(w: number, h: number, brief: Brief, bgDataUrl: string | null, fontB64: string, fontBoldB64: string): string {
  const primary = brief.primary_color || "#1A1A2E";
  const secondary = brief.secondary_color || "#7B2FBE";
  const accent = brief.accent_color || "#FF6B35";
  const accentLight = lighten(accent);
  const headline = escapeXml((brief.headline || "Your App").slice(0, 52));
  const sub = escapeXml((brief.subheadline || "").slice(0, 60));
  const cta = escapeXml(brief.cta_text || "Try Free");
  const appName = escapeXml(brief.app_name || "");
  const showBadges = !!(brief.app_store_url || brief.play_store_url);

  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.05));
  const isWide = w > h * 3;
  const isTall = !isWide && h > w * 1.5;
  const isTiny = h <= 60 || w <= 130;

  const hlSize  = isWide ? Math.max(9, Math.round(h/3.2)) : isTall ? Math.max(13, Math.round(w*0.095)) : Math.max(10, Math.round(h*0.10));
  const subSize = Math.max(8, Math.round(hlSize * 0.65));
  const nameSize= isWide ? Math.max(9, Math.round(h/3.5)) : Math.max(9, Math.round(hlSize * 0.7));
  const ctaSize = Math.max(9, Math.min(18, Math.round(hlSize * 0.85)));
  const ctaW    = Math.min(Math.round(w*(isWide?0.18:0.65)), 180);
  const ctaH    = Math.max(22, Math.min(36, Math.round(h*(isTall?0.07:0.15))));
  const ctaR    = Math.round(ctaH/2.5);

  const hlY   = isTall ? Math.round(h*0.56) : Math.round(h*0.54);
  const subY  = isTall ? Math.round(h*0.72) : Math.round(h*0.73);
  const badgeY= isTall ? Math.round(h*0.80) : Math.round(h*0.82);
  const ctaCy = isTall ? Math.round(h*0.90) : Math.round(h*0.91);

  const charsPerLine = Math.max(8, Math.floor((w - pad*2) / (hlSize * 0.58)));
  const maxLines = isTall ? 3 : isWide ? 1 : 2;
  const lines = wrapText(headline, charsPerLine, maxLines);

  const gradId = `g${w}x${h}`, overId = `ov${w}x${h}`, clipId = `cl${w}x${h}`;
  const fontFamily = "InterCustom";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <style>
    @font-face { font-family: '${fontFamily}'; font-weight: 400; src: url('data:font/woff2;base64,${fontB64}') format('woff2'); }
    @font-face { font-family: '${fontFamily}'; font-weight: 700; src: url('data:font/woff2;base64,${fontBoldB64}') format('woff2'); }
  </style>
  <linearGradient id="${gradId}" x1="0" y1="0" x2="${isWide?"1":"0"}" y2="${isWide?"0":"1"}">
    <stop offset="0%" stop-color="${primary}"/>
    <stop offset="100%" stop-color="${secondary}"/>
  </linearGradient>
  <linearGradient id="${overId}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${primary}" stop-opacity="0"/>
    <stop offset="50%" stop-color="${primary}" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="${primary}" stop-opacity="0.93"/>
  </linearGradient>
  <clipPath id="${clipId}"><rect width="${w}" height="${h}"/></clipPath>
</defs>
<g clip-path="url(#${clipId})">
  ${bgDataUrl
    ? `<image href="${bgDataUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
       <rect width="${w}" height="${h}" fill="${primary}" opacity="0.62"/>`
    : `<rect width="${w}" height="${h}" fill="url(#${gradId})"/>`}
  <rect width="${w}" height="${h}" fill="url(#${overId})"/>

  ${isWide ? `
  <text x="${pad}" y="${Math.round(h/2+nameSize*0.35)}" font-family="${fontFamily}" font-size="${nameSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.8))">${appName}</text>
  <text x="${Math.round(w*0.22)}" y="${Math.round(h/2+hlSize*0.35)}" font-family="${fontFamily}" font-size="${hlSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.8))">${headline.slice(0,50)}</text>
  <rect x="${w - Math.round(w*0.12) - pad - Math.round(ctaW/2)}" y="${Math.round((h-ctaH)/2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="${accent}"/>
  <rect x="${w - Math.round(w*0.12) - pad - Math.round(ctaW/2)}" y="${Math.round((h-ctaH)/2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="none" stroke="${accentLight}" stroke-width="1" opacity="0.5"/>
  <text x="${w - Math.round(w*0.12) - pad}" y="${Math.round(h/2+ctaSize*0.38)}" font-family="${fontFamily}" font-size="${ctaSize}" font-weight="700" fill="white" text-anchor="middle">${cta}</text>
  ` : `
  ${!isTiny && appName ? `<text x="${pad}" y="${pad + Math.round((isTall?52:38)*0.65)}" font-family="${fontFamily}" font-size="${nameSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.8))">${appName}</text>` : ""}
  ${lines.map((line, i) => `<text x="${pad}" y="${hlY + i*Math.round(hlSize*1.25)}" font-family="${fontFamily}" font-size="${hlSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 3px rgba(0,0,0,0.9))">${line}</text>`).join("\n")}
  ${sub && h > 150 ? `<text x="${pad}" y="${subY}" font-family="${fontFamily}" font-size="${subSize}" font-weight="400" fill="#D4D4D8" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.7))">${sub}</text>` : ""}
  ${showBadges && h > 200 && !isTiny ? `
  ${brief.app_store_url ? `<rect x="${pad}" y="${badgeY}" width="100" height="22" rx="4" fill="rgba(0,0,0,0.75)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
  <text x="${pad+50}" y="${badgeY+8}" font-family="${fontFamily}" font-size="7" font-weight="400" fill="#aaa" text-anchor="middle">Download on the</text>
  <text x="${pad+50}" y="${badgeY+17}" font-family="${fontFamily}" font-size="9" font-weight="700" fill="white" text-anchor="middle">App Store</text>` : ""}
  ${brief.play_store_url ? `<rect x="${pad+(brief.app_store_url?108:0)}" y="${badgeY}" width="100" height="22" rx="4" fill="rgba(0,0,0,0.75)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
  <text x="${pad+(brief.app_store_url?108:0)+50}" y="${badgeY+8}" font-family="${fontFamily}" font-size="7" font-weight="400" fill="#aaa" text-anchor="middle">GET IT ON</text>
  <text x="${pad+(brief.app_store_url?108:0)+50}" y="${badgeY+17}" font-family="${fontFamily}" font-size="9" font-weight="700" fill="white" text-anchor="middle">Google Play</text>` : ""}
  ` : ""}
  <rect x="${Math.round(w/2-ctaW/2)}" y="${ctaCy-Math.round(ctaH/2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="${accent}"/>
  <rect x="${Math.round(w/2-ctaW/2)}" y="${ctaCy-Math.round(ctaH/2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="none" stroke="${accentLight}" stroke-width="1" opacity="0.5"/>
  <text x="${Math.round(w/2)}" y="${ctaCy+Math.round(ctaSize*0.38)}" font-family="${fontFamily}" font-size="${ctaSize}" font-weight="700" fill="white" text-anchor="middle">${cta}</text>
  `}
  <rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
</g>
</svg>`;
}

export async function POST(req: NextRequest) {
  try {
    const { brief: rawBrief, frames, iconBase64 } = await req.json();
    void iconBase64; // reserved for future icon overlay

    const niche = rawBrief.niche || "tool";
    const brief: Brief = { ...NICHE_DEFAULTS[niche] || NICHE_DEFAULTS.tool, ...rawBrief };

    // Load fonts from bundled files
    const fontB64 = getFontBase64(false);
    const fontBoldB64 = getFontBase64(true);

    const bestIdx = Math.min(brief.best_frame_index ?? 0, frames.length - 1);
    const bgDataUrl = frames[bestIdx] ? `data:image/jpeg;base64,${frames[bestIdx].base64}` : null;

    const zip = new JSZip();
    const top5Folder = zip.folder("top5")!;
    const allFolder = zip.folder("all_sizes")!;
    const previews: { key: string; width: number; height: number; label: string; isTop5: boolean; dataUrl: string }[] = [];

    for (const size of AD_SIZES) {
      const svg = buildSVG(size.width, size.height, brief, bgDataUrl, fontB64, fontBoldB64);
      const pngBuffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer();
      const filename = `${size.key}.png`;
      if (size.isTop5) top5Folder.file(filename, pngBuffer);
      allFolder.file(filename, pngBuffer);
      previews.push({ key: size.key, width: size.width, height: size.height, label: size.label, isTop5: size.isTop5, dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}` });
    }

    const zipBuffer = await zip.generateAsync({ type:"nodebuffer", compression:"DEFLATE" });
    return NextResponse.json({ success: true, previews, zipBase64: zipBuffer.toString("base64") });
  } catch (err) {
    console.error("Generate error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
