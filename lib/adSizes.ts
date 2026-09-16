// The 3 ratios gpt-image-1 can generate natively.
export type RatioKey = "portrait" | "square" | "landscape";

export interface GenSize {
  key: RatioKey;
  size: string; // gpt-image-1 accepted size string
  label: string;
}

// gpt-image-1 only supports these three sizes. Everything else is resized client-side.
export const GEN_SIZES: GenSize[] = [
  { key: "portrait", size: "1024x1536", label: "9:16 Portrait" },
  { key: "square", size: "1024x1024", label: "1:1 Square" },
  { key: "landscape", size: "1536x1024", label: "16:9 Landscape" },
];

export interface AdSize {
  key: string;
  width: number;
  height: number;
  type: RatioKey;
  usage: string;
  // Legacy aliases kept for canvasGen.ts compatibility
  group: RatioKey;
  label: string;
  isTop5: boolean;
}

// 20 standard Google Ads output sizes (UAC + Display Network).
export const AD_SIZES: AdSize[] = [
  // UAC (Universal App Campaigns) — required for app-install
  { key: "1200x628",  width: 1200, height: 628,  type: "landscape", usage: "UAC Landscape",         group: "landscape", label: "Landscape 1.91:1",      isTop5: true  },
  { key: "1200x1200", width: 1200, height: 1200, type: "square",    usage: "UAC Square",            group: "square",    label: "Square 1:1",            isTop5: true  },
  { key: "1080x1920", width: 1080, height: 1920, type: "portrait",  usage: "UAC Stories",           group: "portrait",  label: "Portrait 9:16",         isTop5: true  },
  // Display — Rectangles
  { key: "300x250",   width: 300,  height: 250,  type: "square",    usage: "Medium Rectangle",      group: "square",    label: "Rectangle 300×250",     isTop5: true  },
  { key: "336x280",   width: 336,  height: 280,  type: "square",    usage: "Large Rectangle",       group: "square",    label: "Rectangle 336×280",     isTop5: false },
  { key: "250x250",   width: 250,  height: 250,  type: "square",    usage: "Square",                group: "square",    label: "Square 250×250",        isTop5: false },
  { key: "200x200",   width: 200,  height: 200,  type: "square",    usage: "Small Square",          group: "square",    label: "Small Square 200×200",  isTop5: false },
  // Display — Leaderboards & Banners
  { key: "728x90",    width: 728,  height: 90,   type: "landscape", usage: "Leaderboard",           group: "landscape", label: "Leaderboard 728×90",    isTop5: false },
  { key: "970x250",   width: 970,  height: 250,  type: "landscape", usage: "Billboard",             group: "landscape", label: "Billboard 970×250",     isTop5: false },
  { key: "970x90",    width: 970,  height: 90,   type: "landscape", usage: "Large Leaderboard",     group: "landscape", label: "Lg Leaderboard 970×90", isTop5: false },
  { key: "930x180",   width: 930,  height: 180,  type: "landscape", usage: "Top Banner",            group: "landscape", label: "Top Banner 930×180",    isTop5: false },
  { key: "468x60",    width: 468,  height: 60,   type: "landscape", usage: "Banner",                group: "landscape", label: "Banner 468×60",         isTop5: false },
  { key: "980x120",   width: 980,  height: 120,  type: "landscape", usage: "Panorama",              group: "landscape", label: "Panorama 980×120",      isTop5: false },
  // Display — Skyscrapers
  { key: "160x600",   width: 160,  height: 600,  type: "portrait",  usage: "Wide Skyscraper",       group: "portrait",  label: "Wide Sky 160×600",      isTop5: false },
  { key: "120x600",   width: 120,  height: 600,  type: "portrait",  usage: "Skyscraper",            group: "portrait",  label: "Skyscraper 120×600",    isTop5: false },
  { key: "300x600",   width: 300,  height: 600,  type: "portrait",  usage: "Half Page",             group: "portrait",  label: "Half Page 300×600",     isTop5: false },
  { key: "300x1050",  width: 300,  height: 1050, type: "portrait",  usage: "Portrait",              group: "portrait",  label: "Portrait 300×1050",     isTop5: false },
  // Display — Mobile
  { key: "320x50",    width: 320,  height: 50,   type: "landscape", usage: "Mobile Banner",         group: "landscape", label: "Mobile Banner 320×50",  isTop5: true  },
  { key: "320x100",   width: 320,  height: 100,  type: "landscape", usage: "Large Mobile Banner",   group: "landscape", label: "Lg Mobile 320×100",     isTop5: false },
  { key: "300x50",    width: 300,  height: 50,   type: "landscape", usage: "Mobile Banner Alt",     group: "landscape", label: "Mobile Banner 300×50",  isTop5: false },
];

// Pick the best base ratio for a target output size, based on its aspect ratio.
export function pickBaseRatio(width: number, height: number): RatioKey {
  const ratio = width / height;
  if (ratio >= 1.5) return "landscape";
  if (ratio <= 0.75) return "portrait";
  return "square";
}

/* ─────────────────── native per-size generation (gpt-image-2.5) ───────────────────
 * gpt-image-2.5 accepts arbitrary WIDTHxHEIGHT, subject to:
 *   - both edges divisible by 16
 *   - aspect ratio between 1:3 and 3:1
 *   - each edge <= 3840px
 *   - total pixels between 655,360 and 8,294,400
 * Google Ads strips (728x90 = 8:1, 120x600 = 1:5) exceed the ratio limit, so we
 * generate at the closest allowed ratio and centre-crop down to the exact size.
 */
const GEN_MIN_PIXELS = 655_360;
const GEN_MAX_PIXELS = 8_294_400;
const GEN_MAX_EDGE = 3840;
const GEN_MIN_RATIO = 1 / 3;
const GEN_MAX_RATIO = 3;

export interface GenPlan {
  /** "WxH" string to send as the API `size` parameter. */
  size: string;
  genW: number;
  genH: number;
  /** Aspect ratio the model actually renders at. */
  genRatio: number;
  /** True when the model renders the target ratio directly (no crop, only a scale). */
  native: boolean;
  /** How much of the generated frame survives the crop (1 = all of it). */
  cropKeep: number;
}

const up16 = (v: number) => Math.max(16, Math.ceil(v / 16) * 16);
const down16 = (v: number) => Math.max(16, Math.floor(v / 16) * 16);

/**
 * Plan a single native generation for one Google Ads size: pick the largest legal
 * canvas at the closest legal aspect ratio, so the crop to `targetW x targetH`
 * never has to upscale.
 */
export function planGenSize(targetW: number, targetH: number): GenPlan {
  const targetRatio = targetW / targetH;
  const genRatio = Math.min(GEN_MAX_RATIO, Math.max(GEN_MIN_RATIO, targetRatio));

  // Pixels needed so that cropping to the target ratio still yields >= target resolution.
  let needed: number;
  if (targetRatio > genRatio) needed = (targetW * targetW) / genRatio; // crop top/bottom
  else if (targetRatio < genRatio) needed = targetH * targetH * genRatio; // crop left/right
  else needed = targetW * targetH;

  const pixels = Math.min(GEN_MAX_PIXELS, Math.max(GEN_MIN_PIXELS, needed));

  let genH = Math.sqrt(pixels / genRatio);
  let genW = genH * genRatio;

  // Snap to the 16px grid, rounding up so we never fall under the pixel floor.
  genW = up16(genW);
  genH = up16(genH);

  // Respect the hard edge cap, then the pixel ceiling, shrinking on the 16px grid.
  if (genW > GEN_MAX_EDGE) { genW = down16(GEN_MAX_EDGE); genH = up16(genW / genRatio); }
  if (genH > GEN_MAX_EDGE) { genH = down16(GEN_MAX_EDGE); genW = up16(genH * genRatio); }
  while (genW * genH > GEN_MAX_PIXELS && genW > 16 && genH > 16) {
    genW = down16(genW - 16);
    genH = down16(genH - 16);
  }

  const actualRatio = genW / genH;
  const cropKeep = actualRatio > targetRatio ? targetRatio / actualRatio : actualRatio / targetRatio;

  return {
    size: `${genW}x${genH}`,
    genW,
    genH,
    genRatio: actualRatio,
    native: Math.abs(actualRatio - targetRatio) / targetRatio < 0.02,
    cropKeep,
  };
}

/** Coarse shape bucket, used to pick a composition brief for the AI. */
export type ShapeKey = "ultrawide" | "wide" | "square" | "tall" | "ultratall";

export function shapeOf(width: number, height: number): ShapeKey {
  const r = width / height;
  if (r >= 2.5) return "ultrawide";
  if (r >= 1.3) return "wide";
  if (r > 0.8) return "square";
  if (r > 0.4) return "tall";
  return "ultratall";
}
