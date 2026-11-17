/**
 * AI Banner overlay: draws the logo lockup, headline, subheadline, CTA and the
 * Google Play badge onto a text-free background rendered by the image model.
 *
 * Browser-only (canvas). Used by the Banner + Ad Copy page, and by the chat
 * toolkit (chat/), which runs this same file in headless Chromium so banners
 * made from a chat look exactly like the ones made on the web.
 */

/** The brief fields the overlay reads. The page's own Brief type carries more. */
export interface BannerBrief {
  app_name: string; tagline?: string; headline: string; subheadline: string; cta_text: string;
  primary_color: string; secondary_color: string; accent_color: string; bg_mode?: string;
}
type Brief = BannerBrief;

function abClamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function abHexToRgb(hex: string): [number, number, number] {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return [26, 26, 46];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function abHexA(hex: string, a: number) { const [r, g, b] = abHexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
/** Whichever of black or white actually contrasts better — a 0.6 luminance cut
 * put white type on mid tones where black would have read far better. */
function abContrast(hex: string) {
  return abContrastRatio(hex, "#141414") >= abContrastRatio(hex, "#FFFFFF") ? "#141414" : "#ffffff";
}
function abLighten(hex: string, amt: number) { const [r, g, b] = abHexToRgb(hex); const f = (c: number) => Math.round(c + (255 - c) * amt); return `rgb(${f(r)},${f(g)},${f(b)})`; }
function abRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function abWrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function abEllipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
export function abLoadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Không load được ảnh."));
    img.src = src;
  });
}

/**
 * Ink colours for the overlay.
 *
 * Every piece of type used to be white on a dark scrim. That breaks entirely on
 * a light background — which is now the default, and what the reference the
 * owner supplied uses — so colour follows bg_mode instead.
 */
/** WCAG relative luminance. */
function abRelLum(hex: string) {
  const [r, g, b] = abHexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function abContrastRatio(a: string, b: string) {
  const la = abRelLum(a), lb = abRelLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function abDarken(hex: string, amt: number) {
  const [r, g, b] = abHexToRgb(hex);
  const f = (c: number) => Math.round(c * (1 - amt));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function abRgbToHsl(hex: string): [number, number, number] {
  const [r, g, b] = abHexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h =
    mx === r ? ((g - b) / d + (g < b ? 6 : 0)) :
    mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return [h * 60, s, l];
}
function abHslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The CTA fill.
 *
 * Keeps the brand hue and rebuilds the colour in HSL rather than multiplying the
 * channels down. Plain darkening drains saturation as it goes, so a pale mauve
 * primary came out a muddy grey-purple — technically legible, visibly dull. Here
 * the hue is preserved, saturation is lifted to a confident minimum, and only
 * lightness moves, down until white type clears 4.5:1.
 *
 * Primary first, then accent: the accent is whatever incidental highlight the
 * brief spotted in the screenshots, and for a purple app it came back blue.
 */
function abUsableAccent(brief: Brief): string {
  for (const c of [brief.primary_color, brief.accent_color]) {
    if (!c) continue;
    const [h, s] = abRgbToHsl(c);
    if (s < 0.12) continue; // greyscale carries no brand hue worth keeping
    const sat = Math.min(0.92, Math.max(0.58, s));
    for (let l = 0.52; l >= 0.24; l -= 0.02) {
      const out = abHslToHex(h, sat, l);
      if (abContrastRatio(out, "#FFFFFF") >= 4.5) return out;
    }
  }
  return "#6D28D9";
}

/**
 * Brand name for the logo lockup.
 *
 * Store titles carry their positioning — "AI Language Tutor - Speka" — and set
 * whole gave the lockup more width and weight than the headline, inverting the
 * hierarchy. Splitting on the usual separators and keeping the shortest part
 * recovers the brand from either ordering.
 */
function abBrandName(full: string): string {
  const parts = (full || "").split(/\s*[-–—:|]\s*/).map((p) => p.trim()).filter((p) => p.length >= 2);
  if (parts.length < 2) return (full || "").trim();
  return parts.reduce((a, b) => {
    const aw = a.split(/\s+/).length, bw = b.split(/\s+/).length;
    if (bw !== aw) return bw < aw ? b : a;
    return b.length < a.length ? b : a;
  });
}

/**
 * Wrap into balanced lines.
 *
 * Plain greedy wrapping fills each line to the edge and strands the remainder,
 * giving "Học Ngôn Ngữ Thông / Minh". Pulling a word down just moves the stub,
 * producing "Học Ngôn / Ngữ / Thông Minh". Instead, once the minimum line count
 * is known, narrow the measure as far as it can go without adding a line — the
 * lines even out on their own.
 */
function abBalancedWrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines = 3): string[] {
  const natural = abWrap(ctx, text, maxW);
  const target = Math.min(natural.length, maxLines);
  if (target <= 1) return natural.slice(0, maxLines);
  let best = natural;
  for (let f = 0.98; f >= 0.55; f -= 0.02) {
    const tryLines = abWrap(ctx, text, maxW * f);
    if (tryLines.length > target) break;
    best = tryLines;
  }
  return best.slice(0, maxLines);
}

/**
 * Largest font at which `text` still fits `maxLines`, with the wrap balanced.
 *
 * Capping the line count alone silently dropped the remainder: a subheadline
 * limited to two lines but wrapping to three lost its last words entirely.
 * Shrinking instead keeps every word.
 */
function abFitLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number, startFs: number, weight: number) {
  let fs = startFs;
  for (; fs > 9; fs -= 1) {
    ctx.font = `${weight} ${fs}px system-ui,Arial,sans-serif`;
    const lines = abWrap(ctx, text, maxW);
    // Counting lines is not enough. A phrase that just fits the column wraps to
    // one line and is still drawn to the last pixel of it, which is how a
    // subheadline reached across the artwork. Require every line to measure
    // inside the column, with a margin so type never touches the picture.
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  ctx.font = `${weight} ${fs}px system-ui,Arial,sans-serif`;
  return { fs, lines: abBalancedWrap(ctx, text, maxW, maxLines) };
}

function abInk(brief: Brief) {
  const light = (brief as { bg_mode?: string }).bg_mode !== "dark";
  const secondary = brief.secondary_color || "#1A1A2E";
  const accent = abUsableAccent(brief);
  return light
    ? { heading: "#14142B", body: "rgba(20,20,43,0.72)", logoText: "#14142B", chip: false, scrim: false, accentText: accent, accent }
    : { heading: "#FFFFFF", body: "rgba(255,255,255,0.88)", logoText: "#FFFFFF", chip: true, scrim: true, accentText: abLighten(accent, 0.15), accent, scrimColor: secondary };
}

/** Icon + app name. Gets a frosted chip only on dark art, where plain type would not read. */
function abDrawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, icon: HTMLImageElement | null, rawName: string, tagline: string, scale: number, ink: ReturnType<typeof abInk>, maxW = Infinity, headFs = Infinity) {
  // The lockup identifies; the headline sells. Keep the brand mark clearly
  // below the headline in weight, and never wider than the column.
  const name = abBrandName(rawName);
  const iconS = Math.round(40 * scale), gap = Math.round(9 * scale);
  let nameFs = Math.round(Math.min(22 * scale, headFs * 0.52));
  let tagFs = Math.max(9, Math.round(nameFs * 0.46));
  if (Number.isFinite(maxW)) {
    const fits = (f: number) => {
      ctx.font = `800 ${f}px system-ui,Arial,sans-serif`;
      return (icon ? iconS + gap : 0) + ctx.measureText(name).width <= maxW;
    };
    while (nameFs > 11 && !fits(nameFs)) nameFs -= 1;
    tagFs = Math.max(9, Math.round(nameFs * 0.46));
  }
  ctx.textAlign = "left";
  ctx.font = `800 ${nameFs}px system-ui,Arial,sans-serif`;
  const nameW = ctx.measureText(name).width;
  ctx.font = `500 ${tagFs}px system-ui,Arial,sans-serif`;
  const textW = Math.max(nameW, tagline ? ctx.measureText(tagline).width : 0);
  const padX = ink.chip ? Math.round(12 * scale) : 0;
  const padY = ink.chip ? Math.round(10 * scale) : 0;
  const chipW = padX * 2 + (icon ? iconS + gap : 0) + textW;
  const chipH = padY * 2 + Math.max(iconS, nameFs + (tagline ? tagFs + 4 * scale : 0));

  if (ink.chip) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 18 * scale; ctx.shadowOffsetY = 4 * scale;
    ctx.fillStyle = "rgba(12,12,22,0.42)";
    abRoundRect(ctx, x, y, chipW, chipH, chipH * 0.28);
    ctx.fill();
    ctx.restore();
  }

  let cx = x + padX;
  const midY = y + chipH / 2;
  if (icon) {
    const iy = midY - iconS / 2;
    ctx.save(); abRoundRect(ctx, cx, iy, iconS, iconS, iconS * 0.24); ctx.clip();
    ctx.drawImage(icon, cx, iy, iconS, iconS); ctx.restore();
    cx += iconS + gap;
  }
  if (tagline) {
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${nameFs}px system-ui,Arial,sans-serif`; ctx.fillStyle = ink.logoText;
    ctx.fillText(name, cx, midY + nameFs * 0.05);
    ctx.font = `500 ${tagFs}px system-ui,Arial,sans-serif`; ctx.fillStyle = ink.body;
    ctx.fillText(abEllipsize(ctx, tagline, Math.max(40, Math.min(maxW, chipW) - (cx - x) - padX)), cx, midY + nameFs * 0.05 + tagFs + 4 * scale);
  } else {
    ctx.textBaseline = "middle";
    ctx.font = `800 ${nameFs}px system-ui,Arial,sans-serif`; ctx.fillStyle = ink.logoText;
    ctx.fillText(name, cx, midY);
  }
  return chipH;
}

/** Accent pill: left circle with a download arrow, label, right chevron. */
/**
 * CTA font size that fits `maxW`. Sizing purely from `scale` overflowed the left
 * column and ellipsized the label to "Học th…", so shrink until the whole pill
 * fits. Layout and drawing both call this, so the reserved height always matches
 * what gets drawn.
 */
function abCtaFontSize(ctx: CanvasRenderingContext2D, maxW: number, label: string, scale: number) {
  const pill = (f: number) => {
    ctx.font = `bold ${f}px system-ui,Arial,sans-serif`;
    return f * 1.5 + f * 0.6 + ctx.measureText(label).width + f * 0.6 + f * 0.9 + f * 1.2;
  };
  let fs = abClamp(Math.round(22 * scale), 12, 46);
  while (fs > 12 && pill(fs) > maxW) fs -= 1;
  return fs;
}
const abCtaHeight = (ctx: CanvasRenderingContext2D, maxW: number, label: string, scale: number) =>
  Math.round(abCtaFontSize(ctx, maxW, label, scale) * 2.2);

function abDrawCTA(ctx: CanvasRenderingContext2D, x: number, y: number, maxW: number, label: string, accent: string, scale: number) {
  ctx.textAlign = "left";
  const fs = abCtaFontSize(ctx, maxW, label, scale);
  const labelW = (ctx.font = `bold ${fs}px system-ui,Arial,sans-serif`, ctx.measureText(label).width);
  const circle = fs * 1.5, chev = fs * 0.9, gap = fs * 0.6;
  const bh = Math.round(fs * 2.2);
  const bw = Math.min(circle + gap + labelW + gap + chev + fs * 1.2, maxW);

  ctx.save();
  ctx.shadowColor = abHexA(accent, 0.45); ctx.shadowBlur = 22 * scale; ctx.shadowOffsetY = 6 * scale;
  const grad = ctx.createLinearGradient(x, y, x + bw, y);
  grad.addColorStop(0, accent); grad.addColorStop(1, abLighten(accent, 0.18));
  ctx.fillStyle = grad;
  abRoundRect(ctx, x, y, bw, bh, bh / 2);
  ctx.fill();
  ctx.restore();

  const cc = abContrast(accent), ccx = x + bh / 2, ccy = y + bh / 2;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath(); ctx.arc(ccx, ccy, circle / 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = cc; ctx.lineWidth = Math.max(2, fs * 0.11); ctx.lineCap = "round";
  const a = circle * 0.24;
  ctx.beginPath();
  ctx.moveTo(ccx, ccy - a); ctx.lineTo(ccx, ccy + a * 0.7);
  ctx.moveTo(ccx - a * 0.6, ccy + a * 0.1); ctx.lineTo(ccx, ccy + a * 0.7); ctx.lineTo(ccx + a * 0.6, ccy + a * 0.1);
  ctx.moveTo(ccx - a * 0.9, ccy + a * 0.9); ctx.lineTo(ccx + a * 0.9, ccy + a * 0.9);
  ctx.stroke();

  ctx.fillStyle = cc; ctx.textBaseline = "middle";
  ctx.font = `bold ${fs}px system-ui,Arial,sans-serif`;
  ctx.fillText(abEllipsize(ctx, label, bw - bh - chev - fs * 1.6), x + bh + gap, ccy + 1);

  const chx = x + bw - fs * 1.1;
  ctx.beginPath();
  ctx.moveTo(chx - chev * 0.3, ccy - chev * 0.5); ctx.lineTo(chx + chev * 0.3, ccy); ctx.lineTo(chx - chev * 0.3, ccy + chev * 0.5);
  ctx.stroke();
  return bh;
}

/**
 * The Google Play mark: four facets meeting at a fold on the centre line.
 * A→P is the straight top edge and B→P the bottom, with the yellow wedge at the
 * tip, which is what makes it read as the real logo rather than a plain
 * triangle. Previous version drew one flat blue triangle.
 */
function abDrawPlayMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const h = size, w = size * 0.88;
  const L = cx - w / 2, R = cx + w / 2, T = cy - h / 2, B = cy + h / 2;
  const K = [L + w * 0.58, cy] as const;                 // the fold
  const Q = [L + w * 0.72, T + h * 0.21] as const;       // on the top edge
  const Rd = [L + w * 0.72, B - h * 0.21] as const;      // on the bottom edge
  const P = [R, cy] as const;                            // the tip

  const tri = (pts: readonly (readonly [number, number])[], fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  tri([[L, T], [L, B], K], "#00A0FF");        // blue spine
  tri([[L, T], Q, K], "#00D26A");             // green, upper
  tri([Q, P, Rd, K], "#FFCE00");              // yellow wedge at the tip
  tri([[L, B], Rd, K], "#FF3A44");            // red, lower
}

/**
 * Store badge. Black with white type on dark art, white with dark type on light
 * art — a black slab was the heaviest thing on a bright banner.
 */
function abDrawPlayBadge(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, onLight: boolean) {
  const bh = Math.round(46 * scale), bw = Math.round(152 * scale);
  ctx.save();
  ctx.fillStyle = onLight ? "#FFFFFF" : "#000000";
  abRoundRect(ctx, x, y, bw, bh, Math.round(8 * scale));
  ctx.fill();
  ctx.strokeStyle = onLight ? "rgba(20,20,43,0.20)" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, scale);
  abRoundRect(ctx, x, y, bw, bh, Math.round(8 * scale));
  ctx.stroke();

  abDrawPlayMark(ctx, x + bh * 0.52, y + bh / 2, bh * 0.56);

  const textX = x + bh * 0.95;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = onLight ? "rgba(20,20,43,0.75)" : "#ffffff";
  ctx.font = `500 ${Math.round(9 * scale)}px system-ui,Arial,sans-serif`;
  ctx.fillText("GET IT ON", textX, y + bh * 0.42);
  ctx.fillStyle = onLight ? "#14142B" : "#ffffff";
  ctx.font = `700 ${Math.round(17 * scale)}px system-ui,Arial,sans-serif`;
  ctx.fillText("Google Play", textX, y + bh * 0.82);
  ctx.restore();
  return bh;
}

/**
 * Headline and subheadline stacked downward from `y`, wrapped to `maxW`.
 * The last headline line takes the accent colour, as in the reference.
 * Returns the y just below the block.
 */
function abDrawHeadlineBlock(ctx: CanvasRenderingContext2D, x: number, y: number, maxW: number, brief: Brief, ink: ReturnType<typeof abInk>, headFs0: number, subFs0: number, maxLines = 3): number {
  let headFs = headFs0, subFs = subFs0;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let cy = y;
  const headline = brief.headline || brief.app_name || "";
  if (headline) {
    const fit = abFitLines(ctx, headline, maxW, maxLines, headFs, 900);
    headFs = fit.fs;
    const lines = fit.lines;
    ctx.font = `900 ${headFs}px system-ui,Arial,sans-serif`;
    // One colour for the whole headline. Accenting the last line copied a
    // reference where the highlight fell on a chosen word; here it falls
    // wherever the text happens to wrap, which splits a phrase at random —
    // "Học Ngôn Ngữ Thông / Minh" left "Minh" a different colour from its own
    // sentence. A highlight has to be chosen, not inherited from line breaks.
    ctx.fillStyle = ink.heading;
    lines.forEach((ln) => {
      cy += headFs;
      ctx.fillText(ln, x, cy);
      cy += headFs * 0.16;
    });
  }
  const sub = brief.subheadline || "";
  if (sub) {
    cy += subFs * 0.7;
    const sf = abFitLines(ctx, sub, maxW, 2, subFs, 500);
    subFs = sf.fs;
    ctx.font = `500 ${subFs}px system-ui,Arial,sans-serif`;
    ctx.fillStyle = ink.body;
    sf.lines.forEach((ln) => {
      cy += subFs;
      ctx.fillText(ln, x, cy);
      cy += subFs * 0.25;
    });
  }
  return cy;
}

/**
 * Composites the layout onto a rendered background.
 *
 * Type sits in a LEFT COLUMN for wide and square frames. The model reliably
 * clears the left side — the composition prompt asks for it and the renders
 * honour it — while it routinely runs the subject to the bottom edge despite
 * being asked not to. Anchoring to the bottom therefore dropped the headline
 * and CTA onto the subject's legs. Tall frames keep a bottom band, since there
 * the subject is centred horizontally and no side is free.
 */
export function abRenderBanner(base: HTMLImageElement, w: number, h: number, brief: Brief, icon: HTMLImageElement | null): string {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const cs = Math.max(w / base.width, h / base.height);
  ctx.drawImage(base, (w - base.width * cs) / 2, (h - base.height * cs) / 2, base.width * cs, base.height * cs);

  const ink = abInk(brief);
  const scale = abClamp(Math.min(w, h) / 500, 0.34, 2.2);
  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.055));
  const accent = ink.accent;
  const ratio = w / h;

  // Strips are too short for a stack; one line of headline plus a small CTA.
  if (h <= 120) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    const base2 = ink.scrimColor || "#1A1A2E";
    g.addColorStop(0, abHexA(base2, 0.94)); g.addColorStop(1, abHexA(base2, 0.5));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const fs = Math.round(h * 0.34);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = `800 ${fs}px system-ui,Arial,sans-serif`; ctx.fillStyle = "#ffffff";
    ctx.fillText(abEllipsize(ctx, brief.headline || brief.app_name || "", w * 0.6), pad, h / 2);
    if (brief.cta_text) abDrawCTA(ctx, w - pad - 160 * scale, (h - 46 * scale) / 2, 160 * scale, brief.cta_text, accent, scale * 0.7);
    return canvas.toDataURL("image/png");
  }

  const leftColumn = ratio > 0.9; // wide and square; tall keeps the bottom band

  if (leftColumn) {
    // Ends short of the artwork rather than flush against it: type that stops
    // exactly where the picture starts still reads as touching it.
    const colW = Math.round(w * (ratio >= 1.3 ? 0.42 : 0.37)) - pad;
    // A whisper of a scrim only — enough to hold type over a soft gradient
    // without turning a deliberately bright background grey.
    if (!ink.scrim) {
      const g = ctx.createLinearGradient(0, 0, colW + pad * 2, 0);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, colW + pad * 2, h);
    } else {
      const g = ctx.createLinearGradient(0, 0, colW + pad * 2, 0);
      g.addColorStop(0, abHexA(ink.scrimColor || "#1A1A2E", 0.88));
      g.addColorStop(1, abHexA(ink.scrimColor || "#1A1A2E", 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, colW + pad * 2, h);
    }

    const headFs = abClamp(Math.round(colW * 0.145), 15, 74);
    const logoH = abDrawLogo(ctx, pad, pad, icon, brief.app_name, brief.tagline || "", scale, ink, colW, headFs);
    const subFs = abClamp(Math.round(colW * 0.062), 11, 30);
    const ctaLabel = brief.cta_text || "Download";
    const ctaH = abCtaHeight(ctx, colW, ctaLabel, scale);
    const badgeH = Math.round(46 * scale);
    const showBadge = h >= 400 && colW >= 200;

    // Centre the text block in the space between the logo and the CTA.
    const blockTop = pad + logoH + pad * 0.8;
    const blockBottom = h - pad - ctaH - (showBadge ? badgeH + pad * 0.5 : 0) - pad * 0.8;
    const est = headFs * 2.4 + subFs * 2.6;
    // Sit nearer the logo. Centring left a slack band above the CTA and
    // another under the lockup, so neither read as deliberate.
    const startY = Math.max(blockTop, blockTop + (blockBottom - blockTop - est) * 0.22);

    abDrawHeadlineBlock(ctx, pad, startY, colW, brief, ink, headFs, subFs);

    let cy = h - pad;
    if (showBadge) { cy -= badgeH; abDrawPlayBadge(ctx, pad, cy, scale, !ink.scrim); cy -= pad * 0.5; }
    cy -= ctaH;
    abDrawCTA(ctx, pad, cy, colW, ctaLabel, accent, scale);
    return canvas.toDataURL("image/png");
  }

  // Tall: bottom band, subject centred above it.
  const bandH = Math.round(h * 0.36);
  const g = ctx.createLinearGradient(0, h - bandH, 0, h);
  const bandBase = ink.scrim ? (ink.scrimColor || "#1A1A2E") : "#FFFFFF";
  g.addColorStop(0, abHexA(bandBase, 0));
  g.addColorStop(0.4, abHexA(bandBase, 0.78));
  g.addColorStop(1, abHexA(bandBase, 0.97));
  ctx.fillStyle = g; ctx.fillRect(0, h - bandH, w, bandH);

  const maxW = w - pad * 2;
  const headFs = abClamp(Math.round(w * 0.075), 16, 78);
  abDrawLogo(ctx, pad, pad, icon, brief.app_name, brief.tagline || "", scale, ink, maxW, headFs);
  const subFs = abClamp(Math.round(w * 0.036), 12, 30);
  const ctaLabel = brief.cta_text || "Download";
  const ctaH = abCtaHeight(ctx, maxW, ctaLabel, scale);
  const badgeH = Math.round(46 * scale);
  const showBadge = w >= 300;

  const textTop = h - bandH + pad * 0.6;
  abDrawHeadlineBlock(ctx, pad, textTop, maxW, brief, ink, headFs, subFs, 2);

  let cy = h - pad;
  if (showBadge) { cy -= badgeH; abDrawPlayBadge(ctx, pad, cy, scale, !ink.scrim); cy -= pad * 0.5; }
  cy -= ctaH;
  abDrawCTA(ctx, pad, cy, maxW, ctaLabel, accent, scale);

  return canvas.toDataURL("image/png");
}
