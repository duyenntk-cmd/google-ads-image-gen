/**
 * Output formats for the AI Banner feature.
 *
 * Deliberately separate from AD_SIZES in adSizes.ts. That list holds 20 entries
 * across only three shapes (7x 1200x628, 7x 1200x1200, 6x 1080x1920) because
 * canvasGen.ts renders one UAC *variant* per entry, each from a different video
 * frame. These are 20 *distinct* Google Ads placements instead, so the two must
 * not be merged.
 */

export type ShapeKey = "ultrawide" | "wide" | "square" | "tall" | "ultratall";

export interface AdFormat {
  key: string;
  width: number;
  height: number;
  /** Where the placement is served, for the UI. */
  usage: string;
  /** Shown under the preview. */
  label: string;
  /** Part of the minimal set worth shipping first. */
  isTop5: boolean;
}

export const GOOGLE_ADS_FORMATS: AdFormat[] = [
  // UAC (Universal App Campaigns) — required for app-install
  { key: "1200x628",  width: 1200, height: 628,  usage: "UAC Landscape",       label: "Landscape 1.91:1",      isTop5: true  },
  { key: "1200x1200", width: 1200, height: 1200, usage: "UAC Square",          label: "Square 1:1",            isTop5: true  },
  { key: "1080x1920", width: 1080, height: 1920, usage: "UAC Stories",         label: "Portrait 9:16",         isTop5: true  },
  // Display — Rectangles
  { key: "300x250",   width: 300,  height: 250,  usage: "Medium Rectangle",    label: "Rectangle 300×250",     isTop5: true  },
  { key: "336x280",   width: 336,  height: 280,  usage: "Large Rectangle",     label: "Rectangle 336×280",     isTop5: false },
  { key: "250x250",   width: 250,  height: 250,  usage: "Square",              label: "Square 250×250",        isTop5: false },
  { key: "200x200",   width: 200,  height: 200,  usage: "Small Square",        label: "Small Square 200×200",  isTop5: false },
  // Display — Leaderboards & Banners
  { key: "728x90",    width: 728,  height: 90,   usage: "Leaderboard",         label: "Leaderboard 728×90",    isTop5: false },
  { key: "970x250",   width: 970,  height: 250,  usage: "Billboard",           label: "Billboard 970×250",     isTop5: false },
  { key: "970x90",    width: 970,  height: 90,   usage: "Large Leaderboard",   label: "Lg Leaderboard 970×90", isTop5: false },
  { key: "930x180",   width: 930,  height: 180,  usage: "Top Banner",          label: "Top Banner 930×180",    isTop5: false },
  { key: "468x60",    width: 468,  height: 60,   usage: "Banner",              label: "Banner 468×60",         isTop5: false },
  { key: "980x120",   width: 980,  height: 120,  usage: "Panorama",            label: "Panorama 980×120",      isTop5: false },
  // Display — Skyscrapers
  { key: "160x600",   width: 160,  height: 600,  usage: "Wide Skyscraper",     label: "Wide Sky 160×600",      isTop5: false },
  { key: "120x600",   width: 120,  height: 600,  usage: "Skyscraper",          label: "Skyscraper 120×600",    isTop5: false },
  { key: "300x600",   width: 300,  height: 600,  usage: "Half Page",           label: "Half Page 300×600",     isTop5: false },
  { key: "300x1050",  width: 300,  height: 1050, usage: "Portrait",            label: "Portrait 300×1050",     isTop5: false },
  // Display — Mobile
  { key: "320x50",    width: 320,  height: 50,   usage: "Mobile Banner",       label: "Mobile Banner 320×50",  isTop5: true  },
  { key: "320x100",   width: 320,  height: 100,  usage: "Large Mobile Banner", label: "Lg Mobile 320×100",     isTop5: false },
  { key: "300x50",    width: 300,  height: 50,   usage: "Mobile Banner Alt",   label: "Mobile Banner 300×50",  isTop5: false },
];

/* ─────────────────── native per-size generation ───────────────────
 * gpt-image-2.5 accepts an arbitrary WIDTHxHEIGHT, subject to:
 *   - both edges divisible by 16
 *   - aspect ratio between 1:3 and 3:1
 *   - each edge <= 3840px
 *   - total pixels between 655,360 and 8,294,400
 * Google Ads strips (728x90 = 8:1, 120x600 = 1:5) exceed the ratio limit, so we
 * render at the closest legal ratio and centre-crop down to the exact size.
 */
const GEN_MIN_PIXELS = 655_360;
const GEN_MAX_PIXELS = 8_294_400;
const GEN_MAX_EDGE = 3840;
const GEN_MIN_RATIO = 1 / 3;
const GEN_MAX_RATIO = 3;

export interface GenPlan {
  /** "WxH" to send as the API `size` parameter. */
  size: string;
  genW: number;
  genH: number;
  /** Aspect ratio the model actually renders at. */
  genRatio: number;
  /** True when the model renders the target ratio directly (scale only, no crop). */
  native: boolean;
  /** Fraction of the generated frame that survives the crop (1 = all of it). */
  cropKeep: number;
}

const up16 = (v: number) => Math.max(16, Math.ceil(v / 16) * 16);
const down16 = (v: number) => Math.max(16, Math.floor(v / 16) * 16);

/**
 * Plan one native generation for a single Google Ads size: the largest legal
 * canvas at the closest legal aspect ratio, so cropping to `targetW x targetH`
 * never has to upscale.
 */
export function planGenSize(targetW: number, targetH: number): GenPlan {
  const targetRatio = targetW / targetH;
  const genRatio = Math.min(GEN_MAX_RATIO, Math.max(GEN_MIN_RATIO, targetRatio));

  // Pixels needed so the crop still yields at least the target resolution.
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

  // Respect the edge cap, then the pixel ceiling, shrinking on the 16px grid.
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

/** Coarse shape bucket, used to pick a composition brief for the model. */
export function shapeOf(width: number, height: number): ShapeKey {
  const r = width / height;
  if (r >= 2.5) return "ultrawide";
  if (r >= 1.3) return "wide";
  if (r > 0.8) return "square";
  if (r > 0.4) return "tall";
  return "ultratall";
}
