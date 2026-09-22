/**
 * Creative set for Google App campaigns (app install).
 *
 * App campaigns do NOT take fixed placement sizes. They take image *assets* in
 * three aspect ratios and Google crops and scales them across its inventory, so
 * the job is to supply 20 visually DIFFERENT creatives spread over those three
 * ratios — not 20 different pixel sizes.
 *
 * Deliberately separate from AD_SIZES in adSizes.ts, which canvasGen.ts uses to
 * render one UAC variant per video frame. Different feature, different list.
 *
 * Ratios and limits confirmed by the account owner against the Google Ads UI:
 *   1.91:1 landscape  min 600x314   recommended 1200x628
 *   1:1    square     min 200x200   recommended 1200x1200
 *   4:5    portrait   min 320x400   recommended 1200x1500
 *   up to 20 images per ad group, <=5MB each, PNG or JPG.
 *
 * Note 9:16 (1080x1920) is the *video* ratio. It is not one of the three image
 * ratios, which is what the earlier 1080x1920 entry in this project got wrong.
 */

export type RatioKey = "landscape" | "square" | "portrait";
export type ShapeKey = "wide" | "square" | "tall";

export interface RatioSpec {
  key: RatioKey;
  /** As Google labels it in the asset UI. */
  ratio: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** How many of the 20 slots this ratio gets. */
  count: number;
}

/** 7 + 7 + 6 = 20, the per-ad-group maximum. */
export const RATIO_SPECS: RatioSpec[] = [
  { key: "landscape", ratio: "1.91:1", width: 1200, height: 628,  minWidth: 600, minHeight: 314, count: 7 },
  { key: "square",    ratio: "1:1",    width: 1200, height: 1200, minWidth: 200, minHeight: 200, count: 7 },
  { key: "portrait",  ratio: "4:5",    width: 1200, height: 1500, minWidth: 320, minHeight: 400, count: 6 },
];

/**
 * Distinct creative angles, rotated across the slots so the 20 assets differ in
 * idea rather than only in random seed. Variety is the point of uploading 20.
 */
const ANGLES: { id: string; label: string; direction: string }[] = [
  { id: "hero",     label: "Hero mascot",   direction: "Classic hero shot: the mascot front and centre, confident and welcoming, presenting the phone toward the viewer." },
  { id: "feature",  label: "Feature focus", direction: "Push the phone mockup forward and large so the app UI is the clear subject; the mascot leans in from the side, gesturing at the screen." },
  { id: "benefit",  label: "Benefit",       direction: "Show the outcome, not the tool: the mascot visibly delighted mid-celebration, phone held loosely, energy and motion in the background." },
  { id: "lifestyle",label: "Lifestyle",     direction: "Everyday context: the mascot casually using the phone as if on a commute or at a desk, relaxed posture, softer natural lighting." },
  { id: "social",   label: "Social proof",  direction: "Two or three friendly characters together around the phone, sharing the moment — the main mascot stays the clear focal point." },
  { id: "bold",     label: "Bold minimal",  direction: "Minimal and graphic: the mascot very large and close, few props, flat bold colour blocking, lots of clean negative space." },
  { id: "discovery",label: "Discovery",     direction: "Curiosity: the mascot pointing or looking toward the phone with an inviting expression, subtle sparkle or glow drawing the eye to the screen." },
];

export interface AdCreative {
  /** Stable id and filename, e.g. "landscape-3". */
  key: string;
  width: number;
  height: number;
  ratioKey: RatioKey;
  ratio: string;
  /** Shown in the UI under the preview. */
  label: string;
  usage: string;
  /** Creative direction appended to the prompt for this slot. */
  angle: string;
  angleLabel: string;
  /**
   * Google advises supplying at least one clean image per ratio with no text
   * burned in, so the first slot of each ratio skips the canvas overlay.
   */
  noOverlay: boolean;
  /** First slot of each ratio — the 3-image set worth generating as a cheap test. */
  isCore: boolean;
}

export const APP_CREATIVES: AdCreative[] = RATIO_SPECS.flatMap((spec) =>
  Array.from({ length: spec.count }, (_, i) => {
    const angle = ANGLES[i % ANGLES.length];
    // Slot 0 of each ratio ships clean, per Google's advice to include at least
    // one asset per ratio without text burned in.
    const noOverlay = i === 0;
    return {
      key: `${spec.key}-${i + 1}`,
      width: spec.width,
      height: spec.height,
      ratioKey: spec.key,
      ratio: spec.ratio,
      label: `${spec.ratio} · ${angle.label}`,
      usage: `${spec.width}×${spec.height}`,
      angle: angle.direction,
      angleLabel: angle.label,
      noOverlay,
      // The preview set must carry the overlay: 17 of 20 assets have one, and a
      // clean render tells you nothing about how the headline and CTA sit.
      // Slot 1 where it exists, otherwise fall back to the only slot there is.
      isCore: spec.count > 1 ? i === 1 : i === 0,
    };
  }),
);

/* ─────────────────── native generation ───────────────────
 * gpt-image-2.5 accepts an arbitrary WIDTHxHEIGHT, subject to:
 *   - both edges divisible by 16
 *   - aspect ratio between 1:3 and 3:1
 *   - each edge <= 3840px
 *   - total pixels between 655,360 and 8,294,400
 * All three App campaign ratios sit comfortably inside those bounds, so the only
 * adjustment is rounding the height up to the 16px grid and trimming it back.
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
  genRatio: number;
  /** True when the model renders the target ratio directly. */
  native: boolean;
  /** Fraction of the generated frame kept by the crop (1 = all of it). */
  cropKeep: number;
}

const up16 = (v: number) => Math.max(16, Math.ceil(v / 16) * 16);
const down16 = (v: number) => Math.max(16, Math.floor(v / 16) * 16);

export function planGenSize(targetW: number, targetH: number): GenPlan {
  const targetRatio = targetW / targetH;
  const genRatio = Math.min(GEN_MAX_RATIO, Math.max(GEN_MIN_RATIO, targetRatio));

  let needed: number;
  if (targetRatio > genRatio) needed = (targetW * targetW) / genRatio;
  else if (targetRatio < genRatio) needed = targetH * targetH * genRatio;
  else needed = targetW * targetH;

  const pixels = Math.min(GEN_MAX_PIXELS, Math.max(GEN_MIN_PIXELS, needed));
  let genH = up16(Math.sqrt(pixels / genRatio));
  let genW = up16(Math.sqrt(pixels / genRatio) * genRatio);

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

export function shapeOf(width: number, height: number): ShapeKey {
  const r = width / height;
  if (r >= 1.3) return "wide";
  if (r > 0.9) return "square";
  return "tall";
}

/**
 * Where the artwork lives inside the finished banner.
 *
 * Wide and square banners keep a text column on the left, so the artwork owns
 * only the remainder. Asking the model for the full frame and then showing the
 * right 62% of it cut the phone in half; asking for exactly the region it will
 * occupy loses nothing.
 *
 * Tall banners keep the artwork full-bleed and put the type in a band across the
 * bottom, where the subject is centred and no side is free anyway.
 *
 * One definition, used by the generator to size its request and by the canvas to
 * place the result — they cannot disagree.
 */
export interface ArtRegion { x: number; y: number; w: number; h: number; column: boolean }

export function artRegion(w: number, h: number): ArtRegion {
  const ratio = w / h;
  if (ratio <= 0.9) return { x: 0, y: 0, w, h, column: false }; // tall: band overlay
  const colFrac = ratio >= 1.3 ? 0.46 : 0.42;
  const x = Math.round(w * colFrac);
  return { x, y: 0, w: w - x, h, column: true };
}
