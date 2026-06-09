import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { AD_SIZES } from "@/lib/adSizes";
import JSZip from "jszip";

export const maxDuration = 60;

interface Brief {
  app_name?: string;
  headline?: string;
  subheadline?: string;
  cta_text?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  background_style?: string;
  mood?: string;
  best_frame_index?: number;
  niche?: string;
  app_store_url?: string;
  play_store_url?: string;
}

const NICHE_DEFAULTS: Record<string, Partial<Brief>> = {
  photo: {
    primary_color: "#7B2FBE", secondary_color: "#E91E8C", accent_color: "#FF6B35",
    headline: "Edit Photos Like a Pro", subheadline: "100+ Filters & AI Tools",
    cta_text: "Edit for Free", background_style: "dark",
  },
  tool: {
    primary_color: "#2563EB", secondary_color: "#60A5FA", accent_color: "#059669",
    headline: "Get More Done in Less Time", subheadline: "Smart tools for every task",
    cta_text: "Try Free", background_style: "light",
  },
  office: {
    primary_color: "#1E3A5F", secondary_color: "#2563EB", accent_color: "#3B82F6",
    headline: "Work Smarter with Your Team", subheadline: "Documents, Sheets & More",
    cta_text: "Start Free Trial", background_style: "light",
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function lighten(hex: string, f = 1.3): string {
  const [r, g, b] = hexToRgb(hex);
  return `#${[r, g, b].map(c => Math.min(255, Math.round(c * f)).toString(16).padStart(2, "0")).join("")}`;
}

// Build SVG for a banner at given dimensions
function buildSVG(w: number, h: number, brief: Brief, bgDataUrl: string | null): string {
  const primary = brief.primary_color || "#1A1A2E";
  const secondary = brief.secondary_color || "#7B2FBE";
  const accent = brief.accent_color || "#FF6B35";
  const accentLight = lighten(accent);
  const headline = (brief.headline || "Your App Name").slice(0, 52);
  const subheadline = (brief.subheadline || "").slice(0, 60);
  const cta = brief.cta_text || "Try Free";
  const appName = brief.app_name || "";
  const showBadges = !!(brief.app_store_url || brief.play_store_url);
  const isTiny = h <= 60 || w <= 130;
  const isWide = w > h * 3;
  const isTall = !isWide && h > w * 1.5;

  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.05));
  const gradId = `g${w}x${h}`;
  const overId = `o${w}x${h}`;
  const clipId = `c${w}x${h}`;

  // Font sizes
  const headlineSize = isWide
    ? Math.max(9, Math.round(h / 3.2))
    : isTall
    ? Math.max(13, Math.round(w * 0.095))
    : Math.max(10, Math.round(h * 0.10));
  const subSize = Math.max(8, Math.round(headlineSize * 0.65));
  const appNameSize = isWide ? Math.max(9, Math.round(h / 3.5)) : Math.max(9, Math.round(headlineSize * 0.7));
  const ctaSize = Math.max(9, Math.min(18, Math.round(headlineSize * 0.85)));

  // CTA button dims
  const ctaW = Math.min(Math.round(w * (isWide ? 0.18 : 0.65)), 180);
  const ctaH = Math.max(22, Math.min(36, Math.round(h * (isTall ? 0.07 : 0.15))));
  const ctaR = Math.round(ctaH / 2.5);

  // Positions — wide layout
  const wideIconSize = Math.min(44, h - pad * 2);
  const wideCtaCx = w - Math.round(w * 0.12) - pad;
  const wideHlX = Math.round(w * 0.23);

  // Square/rect layout
  const iconSize = isTall ? Math.min(52, Math.round(w * 0.17)) : Math.min(38, Math.round(h * 0.13));
  const hlY = isTall ? Math.round(h * 0.56) : Math.round(h * 0.54);
  const subY = isTall ? Math.round(h * 0.72) : Math.round(h * 0.73);
  const badgeY = isTall ? Math.round(h * 0.80) : Math.round(h * 0.82);
  const ctaCy = isTall ? Math.round(h * 0.90) : Math.round(h * 0.91);

  // Wrap headline text
  const charsPerLine = Math.max(8, Math.floor((w - pad * 2) / (headlineSize * 0.58)));
  const words = headline.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if ((cur + " " + word).trim().length > charsPerLine) {
      if (cur) lines.push(cur);
      cur = word;
    } else {
      cur = (cur + " " + word).trim();
    }
  }
  if (cur) lines.push(cur);
  const maxLines = isTall ? 3 : isWide ? 1 : 2;
  const displayLines = lines.slice(0, maxLines);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="${isWide ? "1" : "0"}" y2="${isWide ? "0" : "1"}">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <linearGradient id="${overId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${primary}" stop-opacity="0"/>
      <stop offset="55%" stop-color="${primary}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${primary}" stop-opacity="0.92"/>
    </linearGradient>
    <clipPath id="${clipId}"><rect width="${w}" height="${h}"/></clipPath>
  </defs>
  <g clip-path="url(#${clipId})">
    <!-- Background -->
    ${bgDataUrl
      ? `<image href="${bgDataUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/><rect width="${w}" height="${h}" fill="${primary}" opacity="0.62"/>`
      : `<rect width="${w}" height="${h}" fill="url(#${gradId})"/>`
    }
    <!-- Bottom gradient overlay -->
    <rect width="${w}" height="${h}" fill="url(#${overId})"/>

    ${isWide ? `
    <!-- WIDE LAYOUT -->
    ${appName ? `<text x="${pad + (wideIconSize > 0 ? wideIconSize + 6 : 0)}" y="${Math.round(h / 2 + appNameSize * 0.35)}" font-family="Inter,Arial,sans-serif" font-size="${appNameSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.8))">${appName}</text>` : ""}
    <!-- Headline -->
    <text x="${wideHlX}" y="${Math.round(h / 2 + headlineSize * 0.35)}" font-family="Inter,Arial,sans-serif" font-size="${headlineSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.8))">${headline.slice(0, 50)}</text>
    <!-- CTA -->
    <rect x="${wideCtaCx - Math.round(ctaW / 2)}" y="${Math.round((h - ctaH) / 2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="${accent}" opacity="0.95"/>
    <rect x="${wideCtaCx - Math.round(ctaW / 2)}" y="${Math.round((h - ctaH) / 2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="none" stroke="${accentLight}" stroke-width="1" opacity="0.5"/>
    <text x="${wideCtaCx}" y="${Math.round(h / 2 + ctaSize * 0.35)}" font-family="Inter,Arial,sans-serif" font-size="${ctaSize}" font-weight="700" fill="white" text-anchor="middle">${cta}</text>
    ` : `
    <!-- PORTRAIT / SQUARE LAYOUT -->
    ${!isTiny && appName ? `<text x="${pad + iconSize + 6}" y="${pad + Math.round(iconSize * 0.65)}" font-family="Inter,Arial,sans-serif" font-size="${appNameSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.8))">${appName}</text>` : ""}
    <!-- Headline lines -->
    ${displayLines.map((line, idx) => `<text x="${pad}" y="${hlY + idx * Math.round(headlineSize * 1.25)}" font-family="Inter,Arial,sans-serif" font-size="${headlineSize}" font-weight="700" fill="white" filter="drop-shadow(1px 1px 3px rgba(0,0,0,0.9))">${line}</text>`).join("\n    ")}
    <!-- Subheadline -->
    ${subheadline && h > 150 ? `<text x="${pad}" y="${subY}" font-family="Inter,Arial,sans-serif" font-size="${subSize}" fill="#D4D4D8" filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.7))">${subheadline}</text>` : ""}
    <!-- Store badges -->
    ${showBadges && h > 200 && !isTiny ? `
    ${brief.app_store_url ? `<rect x="${pad}" y="${badgeY}" width="100" height="22" rx="4" fill="rgba(0,0,0,0.75)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    <text x="${pad + 50}" y="${badgeY + 8}" font-family="Inter,Arial,sans-serif" font-size="7" fill="#aaa" text-anchor="middle">Download on the</text>
    <text x="${pad + 50}" y="${badgeY + 17}" font-family="Inter,Arial,sans-serif" font-size="9" font-weight="700" fill="white" text-anchor="middle">App Store</text>` : ""}
    ${brief.play_store_url ? `<rect x="${pad + (brief.app_store_url ? 108 : 0)}" y="${badgeY}" width="100" height="22" rx="4" fill="rgba(0,0,0,0.75)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    <text x="${pad + (brief.app_store_url ? 108 : 0) + 50}" y="${badgeY + 8}" font-family="Inter,Arial,sans-serif" font-size="7" fill="#aaa" text-anchor="middle">GET IT ON</text>
    <text x="${pad + (brief.app_store_url ? 108 : 0) + 50}" y="${badgeY + 17}" font-family="Inter,Arial,sans-serif" font-size="9" font-weight="700" fill="white" text-anchor="middle">Google Play</text>` : ""}
    ` : ""}
    <!-- CTA button -->
    <rect x="${Math.round(w / 2 - ctaW / 2)}" y="${ctaCy - Math.round(ctaH / 2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="${accent}" opacity="0.95"/>
    <rect x="${Math.round(w / 2 - ctaW / 2)}" y="${ctaCy - Math.round(ctaH / 2)}" width="${ctaW}" height="${ctaH}" rx="${ctaR}" fill="none" stroke="${accentLight}" stroke-width="1" opacity="0.5"/>
    <text x="${Math.round(w / 2)}" y="${ctaCy + Math.round(ctaSize * 0.38)}" font-family="Inter,Arial,sans-serif" font-size="${ctaSize}" font-weight="700" fill="white" text-anchor="middle">${cta}</text>
    `}
    <!-- Border -->
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
  </g>
</svg>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { brief: rawBrief, frames, iconBase64, selectedSizes } = body;

    // Merge with niche defaults
    const niche = rawBrief.niche || "tool";
    const defaults = NICHE_DEFAULTS[niche] || NICHE_DEFAULTS.tool;
    const brief: Brief = { ...defaults, ...rawBrief };

    // Get best background frame
    const bestIdx = Math.min(brief.best_frame_index ?? 0, frames.length - 1);
    const bgDataUrl = frames[bestIdx]
      ? `data:image/jpeg;base64,${frames[bestIdx].base64}`
      : null;

    // Which sizes to generate
    const sizesToGen = selectedSizes
      ? AD_SIZES.filter(s => selectedSizes.includes(s.key))
      : AD_SIZES;

    // Generate each banner as PNG via SVG→Sharp
    const zip = new JSZip();
    const top5Folder = zip.folder("top5")!;
    const allFolder = zip.folder("all_sizes")!;
    const previews: { key: string; width: number; height: number; label: string; isTop5: boolean; dataUrl: string }[] = [];

    for (const size of sizesToGen) {
      const svg = buildSVG(size.width, size.height, brief, bgDataUrl);
      const pngBuffer = await sharp(Buffer.from(svg))
        .png({ compressionLevel: 8 })
        .toBuffer();

      const filename = `${size.key}.png`;
      if (size.isTop5) top5Folder.file(filename, pngBuffer);
      allFolder.file(filename, pngBuffer);

      // Preview as base64 dataURL
      const previewBase64 = pngBuffer.toString("base64");
      previews.push({
        key: size.key,
        width: size.width,
        height: size.height,
        label: size.label,
        isTop5: size.isTop5,
        dataUrl: `data:image/png;base64,${previewBase64}`,
      });
    }

    // Generate zip
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const zipBase64 = zipBuffer.toString("base64");

    return NextResponse.json({ success: true, previews, zipBase64 });
  } catch (err) {
    console.error("Generate error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
