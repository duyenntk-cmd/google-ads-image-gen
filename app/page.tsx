"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { extractFramesFromVideo, ExtractedFrame } from "@/lib/videoUtils";
import { AD_SIZES } from "@/lib/adSizes";
import { APP_CREATIVES, RATIO_SPECS } from "@/lib/adFormats";
import { generateAllBanners } from "@/lib/canvasGen";
import { abSaveRun, abListRuns, abLoadArt, abDeleteRun, AbRunMeta } from "@/lib/abHistory";

interface Brief {
  app_name: string; tagline?: string; headline: string; subheadline: string; cta_text: string;
  primary_color: string; secondary_color: string; accent_color: string;
  background_style: string; mood: string; best_frame_index: number;
  niche: string; app_store_url: string; play_store_url: string;
}
interface Preview { key: string; width: number; height: number; label: string; isTop5: boolean; dataUrl: string; }
type Step = "upload" | "analyzing" | "brief" | "generating" | "preview";

/* ───────────────────────── AI Banner ─────────────────────────
 * The model renders a text-free background; everything legible — logo, headline,
 * CTA, Play badge — is drawn here on canvas. That keeps type crisp and identical
 * across all 20 sizes, which an image model cannot guarantee.
 */

/** Parallel image requests in flight, to stay under OpenAI's images rate limit. */
/**
 * Requests in flight.
 *
 * The images endpoint meters input images per minute separately — an edit call
 * sends a mascot and a screenshot, so four in flight blew through a limit of 5
 * immediately. Two leaves room for the server-side retry to recover instead of
 * every request queueing behind the same wall.
 */
const AB_CONCURRENCY = 2;
/** Rough OpenAI list price per image, for the cost hint in the UI. */
const AB_COST_PER_IMAGE: Record<string, number> = { low: 0.006, medium: 0.053, high: 0.211 };
/** Rough USD→VND rate, only for the on-screen estimate. Adjust if it drifts. */
const AB_VND_PER_USD = 26000;
/** abBusyKey sentinel for a multi-slot retry, which is not tied to one card. */
const AB_BUSY_BATCH = "__batch";

/**
 * Store country to pull screenshots from.
 *
 * The phone mockup shows a real store screenshot, so a Global market (which
 * resolves to the US store) put an English interface beside Vietnamese ad copy.
 * When no specific market is chosen, follow the ad-copy language instead — the
 * screenshot should speak the language the banner does.
 */
const AB_LANG_STORE: Record<string, string> = {
  Vietnamese: "Vietnam", Japanese: "Japan", Korean: "South Korea", Thai: "Thailand",
  Indonesian: "Indonesia", Filipino: "Philippines", Malay: "Malaysia", Hindi: "India",
  Bengali: "Bangladesh", Arabic: "Saudi Arabia", Russian: "Russia", German: "Germany",
  French: "France", Spanish: "Spain", Portuguese: "Brazil", "Chinese Simplified": "Taiwan",
};
const abStoreCountry = (market: string, lang: string) =>
  market && market !== "Global" ? market : AB_LANG_STORE[lang] || market || "Global";
const abVnd = (usd: number) => {
  const v = Math.round(usd * AB_VND_PER_USD);
  return v >= 1000 ? `${Math.round(v / 1000).toLocaleString("vi-VN")}k₫` : `${v.toLocaleString("vi-VN")}₫`;
};

/** POST JSON with a timeout, turning a gateway HTML page into a readable error. */
async function abFetchJson(url: string, body: unknown, timeoutMs: number, label: string): Promise<Record<string, any>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error(`${label}: quá ${Math.round(timeoutMs / 1000)}s không phản hồi (server timeout).`);
    throw new Error(`${label}: không gọi được API (${(e as Error)?.message || e}).`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: server trả về HTTP ${res.status} không phải JSON. ${text.slice(0, 120).replace(/\s+/g, " ")}`);
  }
}

/** Last-resort app name when the store lookup is unavailable. */
function abAppNameFromUrl(url: string): string {
  const ios = url.match(/apps\.apple\.com\/[^/]+\/app\/([^/]+)\/id\d+/i);
  if (ios) return decodeURIComponent(ios[1]).replace(/-/g, " ").trim();
  const pkg = url.match(/[?&]id=([^&]+)/);
  if (pkg) {
    const parts = decodeURIComponent(pkg[1]).split(".").filter((p) => !/^(com|net|org|io|app|co|vn|xyz)$/i.test(p));
    if (parts.length) return parts.join(" ");
  }
  return "";
}

/** Run `tasks` with at most `limit` in flight, reporting each completion. */
async function abPool<T>(tasks: (() => Promise<T>)[], limit: number, onDone?: (n: number) => void): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      try { results[i] = { status: "fulfilled", value: await tasks[i]() }; }
      catch (reason) { results[i] = { status: "rejected", reason }; }
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

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
function abLoadImg(src: string): Promise<HTMLImageElement> {
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
function abRenderBanner(base: HTMLImageElement, w: number, h: number, brief: Brief, icon: HTMLImageElement | null): string {
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

const NICHE_DEFAULTS: Record<string, Partial<Brief>> = {
  photo:  { primary_color: "#7B2FBE", secondary_color: "#E91E8C", accent_color: "#FF6B35", headline: "Edit Photos Like a Pro",      subheadline: "100+ Filters & AI Tools",   cta_text: "Edit for Free"    },
  tool:   { primary_color: "#2563EB", secondary_color: "#60A5FA", accent_color: "#059669", headline: "Get More Done in Less Time", subheadline: "Smart tools for every task", cta_text: "Try Free"         },
  office: { primary_color: "#1E3A5F", secondary_color: "#2563EB", accent_color: "#3B82F6", headline: "Work Smarter with Your Team",subheadline: "Documents, Sheets & More",   cta_text: "Start Free Trial" },
};

const LANGUAGES = [
  { code: "English",            label: "🇺🇸 English" },
  { code: "Vietnamese",         label: "🇻🇳 Tiếng Việt" },
  { code: "Indonesian",         label: "🇮🇩 Bahasa Indonesia" },
  { code: "Thai",               label: "🇹🇭 ภาษาไทย" },
  { code: "Korean",             label: "🇰🇷 한국어" },
  { code: "Japanese",           label: "🇯🇵 日本語" },
  { code: "Chinese Simplified", label: "🇨🇳 中文简体" },
  { code: "Arabic",             label: "🇸🇦 العربية" },
  { code: "Spanish",            label: "🇪🇸 Español" },
  { code: "Portuguese",         label: "🇧🇷 Português" },
  { code: "Russian",            label: "🇷🇺 Русский" },
  { code: "French",             label: "🇫🇷 Français" },
  { code: "German",             label: "🇩🇪 Deutsch" },
  { code: "Hindi",              label: "🇮🇳 हिन्दी" },
  { code: "Bengali",            label: "🇧🇩 বাংলা" },
  { code: "Filipino",           label: "🇵🇭 Filipino" },
  { code: "Malay",              label: "🇲🇾 Bahasa Melayu" },
];

const COUNTRY_DEFAULT_LANG: Record<string, string> = {
  Vietnam: "Vietnamese", Indonesia: "Indonesian", Thailand: "Thai",
  Philippines: "Filipino", Malaysia: "Malay", Singapore: "English",
  Myanmar: "English", Cambodia: "English",
  Japan: "Japanese", "South Korea": "Korean", China: "Chinese Simplified",
  Taiwan: "Chinese Simplified", "Hong Kong": "Chinese Simplified",
  India: "Hindi", Pakistan: "English", Bangladesh: "Bengali", "Sri Lanka": "English",
  "Saudi Arabia": "Arabic", UAE: "Arabic", Egypt: "Arabic", Turkey: "English",
  Israel: "English", Iraq: "Arabic",
  USA: "English", Canada: "English", Mexico: "Spanish",
  Brazil: "Portuguese", Argentina: "Spanish", Colombia: "Spanish",
  Chile: "Spanish", Peru: "Spanish",
  Germany: "German", France: "French", "United Kingdom": "English",
  Italy: "English", Spain: "Spanish", Netherlands: "English",
  Poland: "English", Sweden: "English", Norway: "English",
  Denmark: "English", Finland: "English", Belgium: "French",
  Switzerland: "German", Austria: "German", Portugal: "Portuguese",
  Greece: "English", Ukraine: "English", Russia: "Russian",
  Australia: "English", "New Zealand": "English",
  Nigeria: "English", "South Africa": "English", Kenya: "English",
  Ethiopia: "English", Ghana: "English",
};

/** First market that speaks each language — context for the localiser. */
const LANG_MARKET: Record<string,string> = Object.entries(COUNTRY_DEFAULT_LANG)
  .reduce((acc, [country, lang]) => (acc[lang] ? acc : { ...acc, [lang]: country }), {} as Record<string,string>);

/* Codes for MKT template names, so "VI-VN" in MKT's search finds every
 * Vietnamese template. Language + market, ISO 639-1 / ISO 3166-1. */
const LANG_ISO: Record<string,string> = {
  English: "EN", Vietnamese: "VI", Indonesian: "ID", Thai: "TH", Korean: "KO", Japanese: "JA",
  "Chinese Simplified": "ZH", Arabic: "AR", Spanish: "ES", Portuguese: "PT", Russian: "RU",
  French: "FR", German: "DE", Hindi: "HI", Bengali: "BN", Filipino: "TL", Malay: "MS",
};
const COUNTRY_ISO: Record<string,string> = {
  Vietnam: "VN", Indonesia: "ID", Thailand: "TH", Philippines: "PH", Malaysia: "MY", Singapore: "SG",
  Myanmar: "MM", Cambodia: "KH", Japan: "JP", "South Korea": "KR", China: "CN", Taiwan: "TW",
  "Hong Kong": "HK", India: "IN", Pakistan: "PK", Bangladesh: "BD", "Sri Lanka": "LK",
  "Saudi Arabia": "SA", UAE: "AE", Egypt: "EG", Turkey: "TR", Israel: "IL", Iraq: "IQ",
  USA: "US", Canada: "CA", Mexico: "MX", Brazil: "BR", Argentina: "AR", Colombia: "CO",
  Chile: "CL", Peru: "PE", Germany: "DE", France: "FR", "United Kingdom": "GB", Italy: "IT",
  Spain: "ES", Netherlands: "NL", Poland: "PL", Sweden: "SE", Norway: "NO", Denmark: "DK",
  Finland: "FI", Belgium: "BE", Switzerland: "CH", Austria: "AT", Portugal: "PT", Greece: "GR",
  Ukraine: "UA", Russia: "RU", Australia: "AU", "New Zealand": "NZ", Nigeria: "NG",
  "South Africa": "ZA", Kenya: "KE", Ethiopia: "ET", Ghana: "GH",
};
/** Language each Localize market is translated into. */
const MARKET_LANG_ISO: Record<string,string> = {
  VN: "VI", ID: "ID", TH: "TH", PH: "TL", MY: "MS", SG: "EN", KR: "KO", JP: "JA", TW: "ZH",
  CN: "ZH", SA: "AR", BD: "BN", BR: "PT", DE: "DE", FR: "FR", ES: "ES", US: "EN", IN: "HI",
};

const COUNTRIES = [
  { code: "Global",           label: "🌍 Global (Universal)" },
  // Southeast Asia
  { code: "Vietnam",          label: "🇻🇳 Vietnam" },
  { code: "Indonesia",        label: "🇮🇩 Indonesia" },
  { code: "Thailand",         label: "🇹🇭 Thailand" },
  { code: "Philippines",      label: "🇵🇭 Philippines" },
  { code: "Malaysia",         label: "🇲🇾 Malaysia" },
  { code: "Singapore",        label: "🇸🇬 Singapore" },
  { code: "Myanmar",          label: "🇲🇲 Myanmar" },
  { code: "Cambodia",         label: "🇰🇭 Cambodia" },
  // East Asia
  { code: "Japan",            label: "🇯🇵 Japan" },
  { code: "South Korea",      label: "🇰🇷 South Korea" },
  { code: "China",            label: "🇨🇳 China" },
  { code: "Taiwan",           label: "🇹🇼 Taiwan" },
  { code: "Hong Kong",        label: "🇭🇰 Hong Kong" },
  // South Asia
  { code: "India",            label: "🇮🇳 India" },
  { code: "Pakistan",         label: "🇵🇰 Pakistan" },
  { code: "Bangladesh",       label: "🇧🇩 Bangladesh" },
  { code: "Sri Lanka",        label: "🇱🇰 Sri Lanka" },
  // Middle East
  { code: "Saudi Arabia",     label: "🇸🇦 Saudi Arabia" },
  { code: "UAE",              label: "🇦🇪 UAE" },
  { code: "Egypt",            label: "🇪🇬 Egypt" },
  { code: "Turkey",           label: "🇹🇷 Turkey" },
  { code: "Israel",           label: "🇮🇱 Israel" },
  { code: "Iraq",             label: "🇮🇶 Iraq" },
  // North America
  { code: "USA",              label: "🇺🇸 United States" },
  { code: "Canada",           label: "🇨🇦 Canada" },
  { code: "Mexico",           label: "🇲🇽 Mexico" },
  // Latin America
  { code: "Brazil",           label: "🇧🇷 Brazil" },
  { code: "Argentina",        label: "🇦🇷 Argentina" },
  { code: "Colombia",         label: "🇨🇴 Colombia" },
  { code: "Chile",            label: "🇨🇱 Chile" },
  { code: "Peru",             label: "🇵🇪 Peru" },
  // Europe
  { code: "Germany",          label: "🇩🇪 Germany" },
  { code: "France",           label: "🇫🇷 France" },
  { code: "United Kingdom",   label: "🇬🇧 United Kingdom" },
  { code: "Italy",            label: "🇮🇹 Italy" },
  { code: "Spain",            label: "🇪🇸 Spain" },
  { code: "Netherlands",      label: "🇳🇱 Netherlands" },
  { code: "Poland",           label: "🇵🇱 Poland" },
  { code: "Sweden",           label: "🇸🇪 Sweden" },
  { code: "Norway",           label: "🇳🇴 Norway" },
  { code: "Denmark",          label: "🇩🇰 Denmark" },
  { code: "Finland",          label: "🇫🇮 Finland" },
  { code: "Belgium",          label: "🇧🇪 Belgium" },
  { code: "Switzerland",      label: "🇨🇭 Switzerland" },
  { code: "Austria",          label: "🇦🇹 Austria" },
  { code: "Portugal",         label: "🇵🇹 Portugal" },
  { code: "Greece",           label: "🇬🇷 Greece" },
  { code: "Ukraine",          label: "🇺🇦 Ukraine" },
  { code: "Russia",           label: "🇷🇺 Russia" },
  // Oceania
  { code: "Australia",        label: "🇦🇺 Australia" },
  { code: "New Zealand",      label: "🇳🇿 New Zealand" },
  // Africa
  { code: "Nigeria",          label: "🇳🇬 Nigeria" },
  { code: "South Africa",     label: "🇿🇦 South Africa" },
  { code: "Kenya",            label: "🇰🇪 Kenya" },
  { code: "Ethiopia",         label: "🇪🇹 Ethiopia" },
  { code: "Ghana",            label: "🇬🇭 Ghana" },
];

export default function Home() {
  const { data: session } = useSession();
  const [step, setStep] = useState<Step>("upload");
  const [niche, setNiche] = useState<"photo"|"tool"|"office">("photo");
  const [language, setLanguage] = useState("English");
  const [country, setCountry] = useState("Global");
  const [inputMode, setInputMode] = useState<"video"|"image">("video");
  const [videoFile, setVideoFile] = useState<File|null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [iconFile, setIconFile] = useState<File|null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [extractProgress, setExtractProgress] = useState(0);
  const [brief, setBrief] = useState<Brief>({ app_name:"",headline:"",subheadline:"",cta_text:"",primary_color:"#7B2FBE",secondary_color:"#E91E8C",accent_color:"#FF6B35",background_style:"dark",mood:"bold",best_frame_index:0,niche:"photo",app_store_url:"",play_store_url:"" });
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [zipBase64, setZipBase64] = useState("");
  const [error, setError] = useState("");
  const [inpainting, setInpainting] = useState(false);
  const [activeTab, setActiveTab] = useState<"top5"|"all"|"device">("top5");
  const [deviceType, setDeviceType] = useState<"phone"|"tablet">("phone");
  const [devicePreviewIndex, setDevicePreviewIndex] = useState(0);
  const [selectedPreview, setSelectedPreview] = useState<Preview|null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const [darkMode, setDarkMode] = useState(false);
  const bgColor = darkMode ? "#0A0A0F" : "#F8FAFC";
  // kept for compatibility but no longer used
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSidebarTool, setActiveSidebarTool] = useState<"competitor"|"history"|"adcopy"|null>(null);
  void sidebarOpen; void setSidebarOpen; void activeSidebarTool; void setActiveSidebarTool;

  const [activePage, setActivePage] = useState<"home"|"generate"|"adcopy"|"competitor"|"history"|"youtube"|"keywords"|"aibanner"|"localize"|"launch"|"studio"|"mkt">("home");

  // ── AI Banner ──
  type AbStep = "input" | "generating" | "preview";
  const [abStep, setAbStep] = useState<AbStep>("input");
  const [abUrl, setAbUrl] = useState("");
  const [abFetching, setAbFetching] = useState(false);
  const [abFetched, setAbFetched] = useState<{name:string;icon:string|null;shots:number;genre:string;cc:string}|null>(null);
  /** Which step Auto Prompt is on — it makes two calls and can take a minute. */
  const [abPromptStep, setAbPromptStep] = useState("");
  const [abPrompt, setAbPrompt] = useState("");
  const [abCountry, setAbCountry] = useState("Global");
  const [abLang, setAbLang] = useState("Vietnamese");
  const [abQuality, setAbQuality] = useState<"low"|"medium"|"high">("medium");
  const [abError, setAbError] = useState("");
  const [abStatus, setAbStatus] = useState("");
  const [abBrief, setAbBrief] = useState<Brief|null>(null);
  const [abIcon, setAbIcon] = useState<string|null>(null);
  /**
   * The raw AI artwork per slot lives in abBasesRef, not in state: nothing
   * renders from it directly, and 20 PNGs in state re-render the tree for
   * nothing. Every re-render — a new market's wording, a run reopened from
   * history — draws the overlay onto this instead of paying to generate again.
   */
  const [abPreviews, setAbPreviews] = useState<Preview[]>([]);
  const [abZipBase64, setAbZipBase64] = useState("");
  const [abTab, setAbTab] = useState<"top5"|"all">("all");
  const [abPromptLoading, setAbPromptLoading] = useState(false);
  /** Ad-copy language the current creative direction was written for. */
  const [abPromptLang, setAbPromptLang] = useState("");
  const [abCharacter, setAbCharacter] = useState<string|null>(null);
  const [abMascotUsed, setAbMascotUsed] = useState<string|null>(null);
  const [abUseScreenshot, setAbUseScreenshot] = useState(true);
  const [abAutoMascot, setAbAutoMascot] = useState(true);
  /** one = a single asset to approve · core = 1 per ratio · full = all 20. */
  const [abMode, setAbMode] = useState<"one"|"core"|"full">("one");
  /** Which mode produced what is on screen, so the result step offers the right next action. */
  const [abLastMode, setAbLastMode] = useState<"one"|"core"|"full">("one");
  /**
   * Free-text revision entered on the results step. Carried into every later
   * render, including the full set, so approving a tweaked preview delivers
   * twenty assets that share the tweak.
   */
  const [abRevision, setAbRevision] = useState("");
  /** Things the revision asked to remove, forbidden explicitly in the prompt. */
  const [abRemovals, setAbRemovals] = useState<string[]>([]);
  /** Slots that came back empty, so they can be retried without paying for the set. */
  const [abFailed, setAbFailed] = useState<string[]>([]);
  /** Per-card revision text, keyed by slot. Scoped to that one image. */
  const [abCardRev, setAbCardRev] = useState<Record<string,string>>({});
  /** Which single slot is being regenerated, for the per-card spinner. */
  const [abBusyKey, setAbBusyKey] = useState<string|null>(null);
  /** Mirror of abPreviews: a partial regenerate merges into this synchronously. */
  const abPrevRef = useRef<Preview[]>([]);
  const abBasesRef = useRef<Record<string,string>>({});
  /** Id of the run being written to, so a retry updates it instead of adding one. */
  const abRunIdRef = useRef<string>("");

  // Localisation of a finished set: new wording on the artwork already paid for.
  const [abLocLangs, setAbLocLangs] = useState<string[]>([]);
  const [abLocOpen, setAbLocOpen] = useState(false);
  const [abLocSearch, setAbLocSearch] = useState("");
  const abLocRef = useRef<HTMLDivElement>(null);
  const [abLocBusy, setAbLocBusy] = useState("");
  const [abLocSets, setAbLocSets] = useState<{lang:string;previews:Preview[];zip:string}[]>([]);

  // Stored runs.
  const [abHistory, setAbHistory] = useState<AbRunMeta[]>([]);
  const [abHistOpen, setAbHistOpen] = useState(false);
  const [abHistBusy, setAbHistBusy] = useState("");
  /**
   * Store data, brief and mascot from the last run. Regenerating reuses them so
   * a retry bills for one image instead of repeating the store call, the brief
   * and the mascot render.
   */
  const abRun = useRef<{shots:string[];icon:string|null;brief:Brief;mascot:string|null;platform:string}|null>(null);
  const [abPrecise, setAbPrecise] = useState(false);
  const abCharRef = useRef<HTMLInputElement>(null);

  const abReset = () => {
    setAbStep("input"); setAbPreviews([]); setAbBrief(null);
    setAbError(""); setAbStatus("");
    // Drop the cached run too, so the next generate re-reads the store.
    abRun.current = null;
    setAbMascotUsed(null);
    setAbFailed([]);
    abPrevRef.current = [];
    abBasesRef.current = {};
    setAbLocSets([]); setAbLocLangs([]);
    abRunIdRef.current = "";
    setAbCardRev({});
    setAbRevision(""); setAbRemovals([]);
  };

  /**
   * Confirms the URL resolves to a real app before anything is spent on it.
   * Asks for a single screenshot — this is an identity check, not the real fetch.
   */
  const handleAbFetch = async () => {
    if (!abUrl.trim() || abFetching) return;
    setAbFetching(true);
    setAbError("");
    setAbFetched(null);
    try {
      const ss = await abFetchJson("/api/screenshots", { appUrl: abUrl.trim(), country: abStoreCountry(abCountry, abLang), language: abLang, limit: 1 }, 45000, "screenshots");
      if (!ss.success) throw new Error(ss.error || "Không lấy được thông tin app.");
      setAbFetched({
        name: ss.appName || "(không rõ tên)",
        icon: ss.iconBase64 || null,
        shots: ss.totalScreenshots ?? (ss.screenshots?.length || 0),
        genre: ss.genre || "",
        cc: ss.countryCode || "",
      });
      if (ss.iconBase64) setAbIcon(ss.iconBase64);
    } catch (e) {
      setAbError("❌ Kiểm tra app lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAbFetching(false);
    }
  };

  const handleAbAutoPrompt = async () => {
    if (!abUrl.trim() || abPromptLoading) return;
    setAbPromptLoading(true);
    setAbError("");
    setAbPromptStep("Đang lấy dữ liệu từ store...");
    let storeWarn = "";
    try {
      // The store lookup is best-effort: Auto Prompt can still write a direction
      // from the app name alone, so a store failure is a warning, not a stop.
      let appName = "", shots: string[] = [], genre = "";
      try {
        const ss = await abFetchJson("/api/screenshots", { appUrl: abUrl.trim(), country: abStoreCountry(abCountry, abLang), language: abLang, limit: 2 }, 45000, "screenshots");
        if (ss.success) {
          appName = ss.appName || "";
          shots = (ss.screenshots || []).slice(0, 2);
          genre = ss.genre || "";
          if (ss.iconBase64) setAbIcon(ss.iconBase64);
        } else storeWarn = ss.error || "Không lấy được dữ liệu store.";
      } catch (e) { storeWarn = e instanceof Error ? e.message : String(e); }

      if (!appName) appName = abAppNameFromUrl(abUrl);
      if (!appName) throw new Error("Không xác định được tên app từ URL. " + storeWarn);

      setAbPromptStep(`GPT đang phân tích "${appName}" và viết creative direction...`);
      const pd = await abFetchJson("/api/auto-prompt", { appName, niche: genre, screenshots: shots, country: abCountry, language: abLang }, 45000, "auto-prompt");
      if (!pd.success) throw new Error(pd.error || "auto-prompt thất bại.");
      if (!pd.prompt?.trim()) throw new Error("GPT trả về prompt rỗng — thử lại hoặc viết tay.");

      setAbPrompt(pd.prompt.trim());
      setAbPromptLang(abLang);
      if (storeWarn) setAbError(`⚠️ Auto Prompt chạy KHÔNG có screenshot (kém sát hơn): ${storeWarn}`);
    } catch (e) {
      setAbError("❌ Auto Prompt lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAbPromptLoading(false);
      setAbPromptStep("");
    }
  };

  /**
   * @param onlyKeys regenerate just these slots and merge them into what is on
   *   screen. Retrying three failures cost a full set before this — 28,000₫ to
   *   replace 4,200₫ of images.
   * @param revisionOverride a revision that applies to THIS call only. The
   *   rewritten brief stays local, so fixing one frame does not silently
   *   redefine the other nineteen.
   */
  const handleAbGenerate = async (
    mode: "one"|"core"|"full" = abMode, reuse = false, onlyKeys?: string[], revisionOverride?: string,
  ) => {
    if (!abUrl.trim()) return;
    const partial = Boolean(onlyKeys?.length);
    const scoped = revisionOverride !== undefined;
    const revText = (scoped ? revisionOverride! : abRevision).trim();
    // A partial retry stays on the results screen: switching to the progress
    // view would hide the very images being compared against.
    if (partial) setAbBusyKey(onlyKeys!.length === 1 ? onlyKeys![0] : AB_BUSY_BATCH);
    else setAbStep("generating");
    setAbError("");
    try {
      let shots: string[], iconB64: string | null, mascot: string | null, platform: string;
      let theBrief: Brief;

      if (reuse && abRun.current) {
        // Retry path: the store call, brief and mascot are already paid for.
        ({ shots, icon: iconB64, brief: theBrief, mascot, platform } = abRun.current);
        setAbStatus("♻️ Dùng lại brief + mascot, chỉ gen lại ảnh...");
      } else {
      setAbMascotUsed(null);
      setAbStatus("📱 Đang lấy thông tin app...");
      const ss = await abFetchJson("/api/screenshots", { appUrl: abUrl.trim(), country: abStoreCountry(abCountry, abLang), language: abLang }, 60000, "screenshots");
      if (!ss.success) throw new Error(ss.error);
      shots = ss.screenshots || [];
      const appName: string = ss.appName || "";
      iconB64 = ss.iconBase64 || null;
      setAbIcon(iconB64);

      setAbStatus("🤖 GPT-4o đang phân tích app và tạo design brief...");
      const bc = await abFetchJson("/api/banner-concept", {
        appName, prompt: abPrompt, country: abCountry, language: abLang,
        screenshots: shots.slice(0, 3), appUrl: abUrl,
        description: ss.description || "", genre: ss.genre || "",
      }, 60000, "banner-concept");
      platform = ss.platform || "android";
      if (!bc.success) throw new Error(bc.error);
      theBrief = bc.brief;
      setAbBrief(theBrief);

      // One mascot, reused as the reference for every size — this is what keeps
      // the character identical across the whole set.
      mascot = abCharacter;
      if (!mascot && abAutoMascot) {
        setAbStatus("🎭 Đang tìm mascot trong screenshots (hoặc tạo mới)...");
        try {
          const md = await abFetchJson("/api/mascot", { appName, niche: theBrief.niche, screenshots: shots, brief: theBrief, quality: abQuality }, 120000, "mascot");
          if (md.success) mascot = md.source === "screenshot" ? shots[md.index] || null : md.dataUrl || null;
        } catch { /* non-fatal: carry on without a character reference */ }
      }
      setAbMascotUsed(mascot);
      abRun.current = { shots, icon: iconB64, brief: theBrief, mascot, platform };
      }

      // Fold the revision into the brief before rendering. Bolting "remove X"
      // onto a prompt that still describes X leaves X in the picture, so the
      // description itself has to change. Pennies on gpt-4o-mini.
      let removals: string[] = scoped ? [] : abRemovals;
      if (revText) {
        setAbStatus("✏️ Đang áp yêu cầu sửa vào mô tả...");
        try {
          const rv = await abFetchJson("/api/banner-revise", { brief: theBrief, revision: revText }, 45000, "banner-revise");
          if (rv.success && rv.brief) {
            theBrief = rv.brief;
            removals = Array.isArray(rv.removals) ? rv.removals : [];
            // A one-card request edits that card only: keep the rewritten brief
            // in this closure instead of writing it back over the shared one.
            if (!scoped) {
              setAbBrief(theBrief);
              setAbRemovals(removals);
              if (abRun.current) abRun.current.brief = theBrief;
            }
          }
        } catch { /* non-fatal: fall back to the prompt-level instruction alone */ }
      }

      const referenceImages = abUseScreenshot ? shots.slice(0, 1) : [];

      const errors: string[] = [];
      const failedKeys: string[] = [];
      const bases: Record<string,string> = {};
      const baseFor: Record<string, HTMLImageElement> = {};

      // Core mode renders one asset per ratio — a cheap way to check the whole
      // pipeline before committing to all 20.
      // "one" previews a single square asset: the shape that reads composition
      // most clearly, and the cheapest thing to iterate on.
      const slots = partial
        ? APP_CREATIVES.filter((c) => onlyKeys!.includes(c.key))
        : mode === "full" ? APP_CREATIVES
        : mode === "core" ? APP_CREATIVES.filter((c) => c.isCore)
        : [APP_CREATIVES.find((c) => c.ratioKey === "square" && c.isCore)
           ?? APP_CREATIVES.find((c) => c.ratioKey === "square")
           ?? APP_CREATIVES[0]];
      if (!partial) setAbLastMode(mode);
      const total = slots.length;
      setAbStatus(`🎨 Đang gen ${total} ảnh (0/${total})...`);
      const results = await abPool(
        slots.map((c) => () =>
          abFetchJson("/api/banner-generate", {
            brief: theBrief, userPrompt: abPrompt, quality: abQuality,
            width: c.width, height: c.height, key: c.key, angle: c.angle,
            referenceImages, characterImage: mascot, precise: abPrecise, platform, uiLanguage: abLang,
              revision: revText, removals,
          }, 300000, `banner-generate:${c.key}`)),
        AB_CONCURRENCY,
        (n) => setAbStatus(`🎨 Đang gen ${total} ảnh (${n}/${total})...`),
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i], c = slots[i];
        if (r.status === "fulfilled" && r.value?.success && r.value.images?.[0]?.dataUrl) {
          baseFor[c.key] = await abLoadImg(r.value.images[0].dataUrl);
          bases[c.key] = r.value.images[0].dataUrl;
        } else {
          errors.push(`${c.key}: ${r.status === "rejected" ? (r.reason as Error)?.message : r.value?.error || "unknown"}`);
          failedKeys.push(c.key);
        }
      }
      // A partial run only knows about the slots it retried; failures it did not
      // touch are still failures.
      setAbFailed((prev) =>
        partial ? [...prev.filter((k) => !onlyKeys!.includes(k)), ...failedKeys] : failedKeys);

      if (!Object.keys(baseFor).length) throw new Error("Không gen được ảnh nào.\n" + errors.join("\n"));
      // Merge, so retrying one slot does not drop the other nineteen artworks.
      const allBases = partial ? { ...abBasesRef.current, ...bases } : bases;
      abBasesRef.current = allBases;

      setAbStatus(`📐 Overlay logo / hook / CTA / Play badge → ${total} ảnh...`);
      const iconImg = iconB64 ? await abLoadImg(iconB64) : null;
      const { default: JSZipMod } = await import("jszip");
      const zip = new JSZipMod();
      // Foldered by ratio because that is how the assets get uploaded.
      const folders: Record<string, import("jszip")> = {
        landscape: zip.folder("1.91-1_landscape")!,
        square: zip.folder("1-1_square")!,
        portrait: zip.folder("4-5_portrait")!,
      };
      const out: Preview[] = [];

      for (const c of slots) {
        const base = baseFor[c.key];
        if (!base) continue;
        // Every one of the 20 ships finished. A clean asset tells the operator
        // nothing about how the copy sits and spends a slot saying it.
        const dataUrl = abRenderBanner(base, c.width, c.height, theBrief, iconImg);
        out.push({ key: c.key, width: c.width, height: c.height, label: c.label, isTop5: c.isCore, dataUrl });
      }

      // Keep what is already on screen and swap in the slots just rendered, in
      // the canonical order so the grid does not reshuffle around the new ones.
      const byKey = new Map((partial ? abPrevRef.current : []).map((p) => [p.key, p]));
      out.forEach((p) => byKey.set(p.key, p));
      const merged = APP_CREATIVES.map((c) => byKey.get(c.key)).filter(Boolean) as Preview[];
      abPrevRef.current = merged;
      setAbPreviews(merged);

      for (const p of merged) {
        const c = APP_CREATIVES.find((x) => x.key === p.key)!;
        const bytes = Uint8Array.from(atob(p.dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
        folders[c.ratioKey].file(`${c.key}.png`, bytes);
      }

      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const reader = new FileReader();
      reader.onload = () => setAbZipBase64((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);

      // Keep the run. The artwork is the expensive part, and with it on disk a
      // set can be reopened or localised months later for the price of a text
      // call. A retry updates the run it belongs to instead of adding another.
      if (!partial || !abRunIdRef.current) abRunIdRef.current = `run_${Date.now().toString(36)}`;
      try {
        await abSaveRun({
          id: abRunIdRef.current,
          createdAt: Date.now(),
          appName: theBrief.app_name || "",
          appUrl: abUrl.trim(),
          country: abCountry,
          language: abLang,
          quality: abQuality,
          platform,
          brief: theBrief,
          icon: iconB64,
          thumb: await abThumb(merged[0]?.dataUrl || ""),
          slotCount: merged.length,
        }, allBases);
        void abRefreshHistory();
      } catch { /* storage full or blocked: the set on screen is unaffected */ }

      setAbError(errors.length ? "⚠️ Một số size lỗi:\n" + errors.join("\n") : "");
      setAbStatus(`Xong: ${merged.length} banner.`);
      setAbStep("preview");
    } catch (e) {
      setAbError("❌ " + (e instanceof Error ? e.message : String(e)));
      // Dropping back to the form would throw away a finished set of 20 just
      // because one retry failed.
      if (!partial) setAbStep("input");
    } finally {
      setAbBusyKey(null);
    }
  };

  /** Redraws the whole set from stored artwork. No image generation, no cost. */
  /** Small JPEG for the history list, so listing runs does not load 20 PNGs. */
  const abThumb = async (dataUrl: string): Promise<string> => {
    if (!dataUrl) return "";
    try {
      const img = await abLoadImg(dataUrl);
      const w = 160, h = Math.max(1, Math.round((img.height / img.width) * w));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.7);
    } catch { return ""; }
  };

  const abBuildSet = async (bases: Record<string,string>, brief: Brief, iconB64: string|null): Promise<Preview[]> => {
    const iconImg = iconB64 ? await abLoadImg(iconB64) : null;
    const out: Preview[] = [];
    for (const c of APP_CREATIVES) {
      const raw = bases[c.key];
      if (!raw) continue;
      const img = await abLoadImg(raw);
      out.push({
        key: c.key, width: c.width, height: c.height, label: c.label, isTop5: c.isCore,
        dataUrl: abRenderBanner(img, c.width, c.height, brief, iconImg),
      });
    }
    return out;
  };

  const abZipOf = async (previews: Preview[]): Promise<string> => {
    const { default: JSZipMod } = await import("jszip");
    const zip = new JSZipMod();
    const folders: Record<string, import("jszip")> = {
      landscape: zip.folder("1.91-1_landscape")!,
      square: zip.folder("1-1_square")!,
      portrait: zip.folder("4-5_portrait")!,
    };
    for (const p of previews) {
      const c = APP_CREATIVES.find((x) => x.key === p.key);
      if (!c) continue;
      const bytes = Uint8Array.from(atob(p.dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
      folders[c.ratioKey].file(`${c.key}.png`, bytes);
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(",")[1]);
      r.readAsDataURL(blob);
    });
  };

  const abDownloadB64Zip = (b64: string, name: string) => {
    const a = document.createElement("a");
    a.href = `data:application/zip;base64,${b64}`;
    a.download = name;
    a.click();
  };

  /**
   * One more market from a finished set. Only the four printed strings change;
   * the artwork is reused, so this is a text call per market, not twenty images.
   */
  const handleAbLocalize = async () => {
    if (!abBrief || !abLocLangs.length) return;
    const bases = abBasesRef.current;
    if (!Object.keys(bases).length) { setAbError("❌ Không còn ảnh gốc để vẽ lại. Gen lại bộ ảnh trước."); return; }
    setAbError("");
    const sets: {lang:string;previews:Preview[];zip:string}[] = [];
    for (const lang of abLocLangs) {
      setAbLocBusy(`🌏 Đang localize sang ${lang}...`);
      try {
        const r = await abFetchJson("/api/banner-localize", {
          copy: {
            headline: abBrief.headline, subheadline: abBrief.subheadline,
            cta_text: abBrief.cta_text, tagline: abBrief.tagline || "",
          },
          language: lang,
          country: LANG_MARKET[lang] || "",
          appName: abBrief.app_name,
        }, 60000, `banner-localize:${lang}`);
        if (!r.success) throw new Error(r.error || "localize thất bại");
        const localBrief = { ...abBrief, ...r.copy } as Brief;
        const previews = await abBuildSet(bases, localBrief, abIcon);
        sets.push({ lang, previews, zip: await abZipOf(previews) });
      } catch (e) {
        setAbError(`⚠️ ${lang}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setAbLocBusy("");
    // Replace a market already produced rather than listing it twice.
    setAbLocSets((prev) => [...prev.filter((s) => !sets.some((n) => n.lang === s.lang)), ...sets]);
  };

  const abRefreshHistory = async () => {
    try { setAbHistory(await abListRuns()); } catch { /* private window, or storage blocked */ }
  };
  useEffect(() => { void abRefreshHistory(); }, []);

  // Close the market picker on an outside click; a multi-select stays open
  // while choosing, so it needs a way out that is not another click on itself.
  useEffect(() => {
    if (!abLocOpen) return;
    const onDown = (e: MouseEvent) => {
      if (abLocRef.current && !abLocRef.current.contains(e.target as Node)) setAbLocOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [abLocOpen]);

  /** Reopens a stored run: artwork off disk, overlay redrawn, ready to localise. */
  const handleAbOpenRun = async (meta: AbRunMeta) => {
    setAbHistBusy(meta.id);
    try {
      const bases = await abLoadArt(meta.id);
      if (!bases || !Object.keys(bases).length) throw new Error("Không còn ảnh gốc của lần gen này.");
      const brief = meta.brief as Brief;
      const previews = await abBuildSet(bases, brief, meta.icon);
      abBasesRef.current = bases;
      abRunIdRef.current = meta.id;
      abPrevRef.current = previews; setAbPreviews(previews);
      setAbBrief(brief); setAbIcon(meta.icon); setAbUrl(meta.appUrl);
      setAbCountry(meta.country); setAbLang(meta.language);
      setAbZipBase64(await abZipOf(previews));
      setAbLocSets([]); setAbLocLangs([]); setAbFailed([]); setAbError(""); setAbRevision("");
      // The cached run is what "gen lại" reuses; without it a retry would go
      // back to the store and rebuild the brief from scratch.
      abRun.current = { shots: [], icon: meta.icon, brief, mascot: null, platform: meta.platform || "android" };
      setAbHistOpen(false);
      setAbStep("preview");
    } catch (e) {
      setAbError("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAbHistBusy("");
    }
  };

  const handleAbDeleteRun = async (id: string) => {
    try { await abDeleteRun(id); await abRefreshHistory(); } catch { /* nothing to do */ }
  };

  const abDownloadZip = () => {
    if (!abZipBase64) return;
    const a = document.createElement("a");
    a.href = `data:application/zip;base64,${abZipBase64}`;
    a.download = `google-ads-${abBrief?.app_name || "banners"}.zip`;
    a.click();
  };
  const abShown = abTab === "top5" ? abPreviews.filter((p) => p.isTop5) : abPreviews;

  // YouTube upload state
  const [ytAuthenticated, setYtAuthenticated] = useState(false);
  const [ytAccessToken, setYtAccessToken] = useState("");
  interface YtVideo { file: File; title: string; description: string; tags: string; privacy: "public"|"unlisted"|"private"; status: "idle"|"uploading"|"done"|"error"; progress: number; errorMsg: string; videoId?: string; }
  const [ytVideos, setYtVideos] = useState<YtVideo[]>([]);
  const [ytUploading, setYtUploading] = useState(false);
  const [ytCopiedIndex, setYtCopiedIndex] = useState<number|null>(null);
  const ytFileRef = useRef<HTMLInputElement>(null);

  const checkYtAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/token");
      if (res.ok) { const d = await res.json(); if (d.access_token) { setYtAccessToken(d.access_token); setYtAuthenticated(true); } }
    } catch {}
  }, []);

  useEffect(() => { checkYtAuth(); }, [checkYtAuth]);

  // Handle OAuth redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yt_ok")) { setActivePage("youtube"); checkYtAuth(); window.history.replaceState({}, "", "/"); }
    if (params.get("page") === "youtube") { setActivePage("youtube"); window.history.replaceState({}, "", "/"); }
  }, [checkYtAuth]);

  const addYtFiles = (files: FileList) => {
    const newVids: YtVideo[] = Array.from(files).map(f => ({
      file: f, title: f.name.replace(/\.[^.]+$/, ""), description: "", tags: "", privacy: "unlisted",
      status: "idle", progress: 0, errorMsg: "",
    }));
    setYtVideos(prev => [...prev, ...newVids]);
  };

  const uploadSingleVideo = async (video: YtVideo, index: number, token: string): Promise<void> => {
    setYtVideos(prev => prev.map((v, i) => i === index ? {...v, status: "uploading", progress: 0} : v));
    try {
      const metadata = {
        snippet: { title: video.title || video.file.name, description: video.description, tags: video.tags ? video.tags.split(",").map(t=>t.trim()) : [] },
        status: { privacyStatus: video.privacy },
      };
      // 1. Init resumable upload
      const initRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "X-Upload-Content-Type": video.file.type, "X-Upload-Content-Length": String(video.file.size) },
        body: JSON.stringify(metadata),
      });
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const uploadUrl = initRes.headers.get("Location");
      if (!uploadUrl) throw new Error("No upload URL");

      // 2. Upload in chunks
      const CHUNK = 5 * 1024 * 1024; // 5MB
      let offset = 0;
      while (offset < video.file.size) {
        const chunk = video.file.slice(offset, offset + CHUNK);
        const end = Math.min(offset + CHUNK - 1, video.file.size - 1);
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${offset}-${end}/${video.file.size}`, "Content-Type": video.file.type },
          body: chunk,
        });
        if (uploadRes.status === 308) {
          const range = uploadRes.headers.get("Range");
          offset = range ? parseInt(range.split("-")[1]) + 1 : offset + CHUNK;
        } else if (uploadRes.ok || uploadRes.status === 201 || uploadRes.status === 200) {
          const resData = await uploadRes.json().catch(() => ({}));
          const vid = resData?.id;
          setYtVideos(prev => prev.map((v, i) => i === index ? {...v, videoId: vid || undefined} : v));
          offset = video.file.size;
        } else {
          throw new Error(`Upload chunk failed: ${uploadRes.status}`);
        }
        const pct = Math.round((Math.min(offset, video.file.size) / video.file.size) * 100);
        setYtVideos(prev => prev.map((v, i) => i === index ? {...v, progress: pct} : v));
      }
      setYtVideos(prev => prev.map((v, i) => i === index ? {...v, status: "done", progress: 100} : v));
    } catch (e) {
      setYtVideos(prev => prev.map((v, i) => i === index ? {...v, status: "error", errorMsg: String(e)} : v));
    }
  };

  const handleYtUploadAll = async () => {
    if (!ytAccessToken) return;
    setYtUploading(true);
    for (let i = 0; i < ytVideos.length; i++) {
      if (ytVideos[i].status === "idle" || ytVideos[i].status === "error") {
        await uploadSingleVideo(ytVideos[i], i, ytAccessToken);
      }
    }
    setYtUploading(false);
  };

  const ytLogout = async () => {
    await fetch("/api/auth/token", { method: "DELETE" });
    setYtAuthenticated(false); setYtAccessToken(""); setYtVideos([]);
  };


  // Google Ads Launch state
  const [adsConnected, setAdsConnected] = useState<boolean|null>(null);
  const [adsAccounts, setAdsAccounts] = useState<{id:string;name:string;currency:string;status:string}[]>([]);
  const [adsSelectedAccount, setAdsSelectedAccount] = useState("");
  const [adsCampaignName, setAdsCampaignName] = useState("");
  const [adsAppId, setAdsAppId] = useState("");
  const [adsAppStore, setAdsAppStore] = useState<"GOOGLE_APP_STORE"|"APPLE_APP_STORE">("GOOGLE_APP_STORE");
  const [adsBudget, setAdsBudget] = useState("200000");
  const [adsHeadlines, setAdsHeadlines] = useState(["","",""]);
  const [adsDescriptions, setAdsDescriptions] = useState(["",""]);
  const [adsSelectedBanners, setAdsSelectedBanners] = useState<string[]>([]);
  const [adsLaunching, setAdsLaunching] = useState(false);
  const [adsResult, setAdsResult] = useState<{success:boolean;message?:string;error?:string}|null>(null);
  const [adsCampaigns, setAdsCampaigns] = useState<{id:string;name:string;status:string;budgetPerDay:number}[]>([]);
  const [adsAccountsError, setAdsAccountsError] = useState<string|null>(null);
  const [adsNeedsBasicAccess, setAdsNeedsBasicAccess] = useState(false);
  const [adsAccountsLoading, setAdsAccountsLoading] = useState(false);

  /**
   * Assets offered for upload. AI Banner is where the App campaign creatives
   * come from now, so its set leads; Gen Banner's output still counts.
   */
  const adsBannerPool = abPreviews.length ? abPreviews : previews;

  const checkAdsConnection = async () => {
    try {
      const res = await fetch("/api/google-ads/auth?action=status");
      if (!res.ok) { setAdsConnected(false); return; }
      const data = await res.json();
      setAdsConnected(data.connected);
      if (data.connected) loadAdsAccounts();
    } catch { setAdsConnected(false); }
  };

  const loadAdsAccounts = async () => {
    setAdsAccountsLoading(true);
    setAdsAccountsError(null);
    setAdsNeedsBasicAccess(false);
    try {
      const res = await fetch("/api/google-ads/accounts");
      const text = await res.text();
      let data: {success:boolean;accounts?:{id:string;name:string;currency:string;status:string}[];error?:string;needs_basic_access?:boolean};
      try { data = JSON.parse(text); } catch { throw new Error(`Server returned HTML (middleware issue). Status: ${res.status}`); }
      if (data.success) setAdsAccounts(data.accounts || []);
      else if (data.needs_basic_access) setAdsNeedsBasicAccess(true);
      else setAdsAccountsError(data.error || "Unknown error");
    } catch(e) { setAdsAccountsError(String(e)); }
    setAdsAccountsLoading(false);
  };

  const loadAdsCampaigns = async (customerId: string) => {
    const res = await fetch(`/api/google-ads/campaigns?customerId=${customerId}`);
    const data = await res.json();
    if (data.success) setAdsCampaigns(data.campaigns || []);
  };

  const handleAdsLaunch = async () => {
    if (!adsSelectedAccount || !adsCampaignName || !adsAppId) return;
    setAdsLaunching(true); setAdsResult(null);
    try {
      const res = await fetch("/api/google-ads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: adsSelectedAccount,
          campaignName: adsCampaignName,
          appId: adsAppId,
          appStore: adsAppStore,
          budgetPerDayVnd: parseInt(adsBudget) || 200000,
          headlines: adsHeadlines.filter(Boolean),
          descriptions: adsDescriptions.filter(Boolean),
          imageDataUrls: adsSelectedBanners,
        }),
      });
      const data = await res.json();
      setAdsResult(data);
      if (data.success) loadAdsCampaigns(adsSelectedAccount);
    } catch (e) { setAdsResult({ success: false, error: String(e) }); }
    setAdsLaunching(false);
  };

  // Localize state
  const LOCALIZE_MARKETS = [
    { code: "VN", name: "Vietnam",      flag: "🇻🇳" },
    { code: "ID", name: "Indonesia",    flag: "🇮🇩" },
    { code: "TH", name: "Thailand",     flag: "🇹🇭" },
    { code: "PH", name: "Philippines",  flag: "🇵🇭" },
    { code: "MY", name: "Malaysia",     flag: "🇲🇾" },
    { code: "SG", name: "Singapore",    flag: "🇸🇬" },
    { code: "KR", name: "South Korea",  flag: "🇰🇷" },
    { code: "JP", name: "Japan",        flag: "🇯🇵" },
    { code: "TW", name: "Taiwan",       flag: "🇹🇼" },
    { code: "CN", name: "China",        flag: "🇨🇳" },
    { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
    { code: "BD", name: "Bangladesh",   flag: "🇧🇩" },
    { code: "BR", name: "Brazil",       flag: "🇧🇷" },
    { code: "DE", name: "Germany",      flag: "🇩🇪" },
    { code: "FR", name: "France",       flag: "🇫🇷" },
    { code: "ES", name: "Spain",        flag: "🇪🇸" },
    { code: "US", name: "United States",flag: "🇺🇸" },
    { code: "IN", name: "India",        flag: "🇮🇳" },
  ];
  interface LocalizeMarketResult { code: string; name: string; language: string; flag: string; headlines: string[]; descriptions: string[]; ctas: string[]; }

  /* ─────────────── Ad Copy Studio ───────────────
   * Keywords, ad copy and localisation were three pages that each asked for the
   * app again and passed nothing to the next one. They are one flow: research a
   * keyword, write copy FOR that keyword, ship it to other markets.
   */
  interface SdKeyword {
    keyword: string; monthly_searches: string; competition: string;
    competition_index: number; cpc_min: number; cpc_max: number;
    relevance: number; intent: string;
  }
  const [sdUrl, setSdUrl] = useState("");
  const [sdCountry, setSdCountry] = useState("Global");
  const [sdLang, setSdLang] = useState("English");
  const [sdAppName, setSdAppName] = useState("");
  const [sdKeywords, setSdKeywords] = useState<SdKeyword[]>([]);
  const [sdLoading, setSdLoading] = useState(false);
  const [sdMoreLoading, setSdMoreLoading] = useState(false);
  const [sdError, setSdError] = useState("");
  const [sdSelected, setSdSelected] = useState<string>("");
  const [sdCopy, setSdCopy] = useState<{headlines:string[];descriptions:string[];ctas:string[]}|null>(null);
  const [sdCopyLoading, setSdCopyLoading] = useState(false);
  const [sdCopied, setSdCopied] = useState("");
  const [sdLocOpen, setSdLocOpen] = useState(false);
  const [sdLocSearch, setSdLocSearch] = useState("");
  const [sdLocMarkets, setSdLocMarkets] = useState<string[]>([]);
  const [sdLocLoading, setSdLocLoading] = useState(false);
  const sdLocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sdLocOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sdLocRef.current && !sdLocRef.current.contains(e.target as Node)) setSdLocOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sdLocOpen]);

  /**
   * "10K-100K" and "1M+" sort as strings in the wrong order entirely, so a
   * volume band becomes a number first. Highest first is the whole point of the
   * list — the operator reads from the top.
   */
  const sdVolumeScore = (band: string): number => {
    const unit = (s: string) => {
      const m = s.trim().match(/^([\d.]+)\s*([KMB]?)/i);
      if (!m) return 0;
      const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K"|"M"|"B"] ?? 1;
      return parseFloat(m[1]) * mult;
    };
    const parts = String(band || "").split("-");
    if (parts.length === 2) return (unit(parts[0]) + unit(parts[1])) / 2;
    // "1M+" has no upper bound; treat it as the band above its floor.
    return band?.includes("+") ? unit(parts[0]) * 2 : unit(parts[0]);
  };
  const sdSortByVolume = (list: SdKeyword[]) =>
    [...list].sort((a, b) => sdVolumeScore(b.monthly_searches) - sdVolumeScore(a.monthly_searches));

  const sdFetchKeywords = async (more = false) => {
    if (!sdUrl.trim()) return;
    if (more) setSdMoreLoading(true); else setSdLoading(true);
    setSdError("");
    if (!more) { setSdKeywords([]); setSdSelected(""); setSdCopy(null); }
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appUrl: sdUrl.trim(), appName: sdAppName, country: sdCountry, language: sdLang,
          exclude: more ? sdKeywords.map(k => k.keyword) : [],
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Không lấy được keyword.");
      const found: SdKeyword[] = data.result?.keywords || [];
      if (data.result?.app_name && !sdAppName) setSdAppName(data.result.app_name);
      setSdKeywords(prev => {
        // The model is told not to repeat, but a near-duplicate still slips in.
        const seen = new Set(prev.map(k => k.keyword.toLowerCase()));
        return sdSortByVolume([...prev, ...found.filter(k => !seen.has(k.keyword.toLowerCase()))]);
      });
    } catch (e) {
      setSdError("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (more) setSdMoreLoading(false); else setSdLoading(false);
    }
  };

  /** Copy written FOR the chosen keyword — that is the point of picking one. */
  const sdGenerateCopy = async (keyword: string) => {
    setSdSelected(keyword);
    setSdCopyLoading(true);
    setSdCopy(null); setSdError(""); setSdSelH([]); setSdSelD([]);
    try {
      const res = await fetch("/api/adcopy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: sdAppName || sdUrl,
          message: `Target keyword: "${keyword}". Every headline must read as an answer to someone searching that phrase; work the keyword or its close variant into at least three of the five headlines.`,
          country: sdCountry, language: sdLang,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Không tạo được ad copy.");
      setSdCopy({
        headlines: data.result.headlines || [],
        descriptions: data.result.descriptions || [],
        ctas: data.result.ctas || [],
      });
    } catch (e) {
      setSdError("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSdCopyLoading(false);
    }
  };

  const sdCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setSdCopied(key);
    setTimeout(() => setSdCopied(""), 1500);
  };


  /* ─────────────── MKT System ───────────────
   * The connect code is the user's credential for up to a day and cannot be
   * revoked, so it is posted once to our server, kept in an httpOnly cookie and
   * never held here. This side only ever knows the email and the expiry.
   */
  interface MktTemplate { id: string; name: string; adContents?: {headlines:string[];descriptions:string[]}[] }
  const [mkCode, setMkCode] = useState("");
  const [mkConn, setMkConn] = useState<{email:string;expiresAt:number}|null>(null);
  const [mkBusy, setMkBusy] = useState("");
  const [mkError, setMkError] = useState("");
  const [mkNote, setMkNote] = useState("");
  const [mkTemplates, setMkTemplates] = useState<MktTemplate[]>([]);
  const [mkTplName, setMkTplName] = useState("");
  const [mkBlocks, setMkBlocks] = useState<{headlines:string;descriptions:string}[]>([{headlines:"",descriptions:""}]);
  const [mkPicked, setMkPicked] = useState<string[]>([]);
  const [mkPublic, setMkPublic] = useState(false);
  const [mkFiles, setMkFiles] = useState<{name:string;dataUrl:string}[]>([]);
  const mkFileRef = useRef<HTMLInputElement>(null);
  /** Kept across retries of the same upload so the backend replays instead of duplicating. */
  const mkIdemRef = useRef<string>("");

  const mkParseBlocks = () => mkBlocks.map(b => ({
    headlines: b.headlines.split("\n").map(s => s.trim()).filter(Boolean),
    descriptions: b.descriptions.split("\n").map(s => s.trim()).filter(Boolean),
  }));

  /**
   * The campaign-time rule, checked per block, live.
   *
   * MKT System's backend will happily SAVE a template whose block has one
   * headline or no description — and then refuse to build a campaign from it.
   * Better to be stopped here than at launch.
   */
  const mkValidate = (blocks: {headlines:string[];descriptions:string[]}[]): string[] => {
    const out: string[] = [];
    blocks.forEach((b, i) => {
      const label = `Khối ${i + 1}`;
      const heads = Array.from(new Set(b.headlines));
      if (heads.length < 2) out.push(`${label}: cần ≥2 headline khác nhau (đang có ${heads.length}).`);
      if (heads.length > 5) out.push(`${label}: tối đa 5 headline.`);
      if (b.descriptions.length < 1) out.push(`${label}: cần ≥1 description.`);
      if (b.descriptions.length > 5) out.push(`${label}: tối đa 5 description.`);
      heads.filter(h => h.length > 30).forEach(h => out.push(`${label}: headline ${h.length} ký tự (tối đa 30) — "${h}"`));
      b.descriptions.filter(d => d.length > 90).forEach(d => out.push(`${label}: description ${d.length} ký tự (tối đa 90)`));
    });
    return out;
  };
  const mkBlockErrors = (): string[] => mkValidate(mkParseBlocks());

  const mkFetchJson = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.success === false || data?.connected === false) {
      if (data?.error === "not_connected" || res.status === 401) {
        setMkConn(null);
        throw new Error("Chưa kết nối MKT System, hoặc mã đã hết hạn. Dán mã mới.");
      }
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  };

  const mkRefreshConn = async () => {
    try {
      const d = await fetch("/api/mkt/connect").then(r => r.json());
      setMkConn(d.connected ? { email: d.email, expiresAt: d.expiresAt } : null);
    } catch { setMkConn(null); }
  };
  useEffect(() => { void mkRefreshConn(); }, []);

  const mkConnect = async () => {
    if (!mkCode.trim()) return;
    setMkBusy("connect"); setMkError(""); setMkNote("");
    try {
      const d = await mkFetchJson("/api/mkt/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mkCode.trim() }),
      });
      setMkConn({ email: d.email, expiresAt: d.expiresAt });
      setMkCode("");
      await mkLoadTemplates();
    } catch (e) { setMkError("❌ " + (e instanceof Error ? e.message : String(e))); }
    finally { setMkBusy(""); }
  };

  const mkDisconnect = async () => {
    await fetch("/api/mkt/connect", { method: "DELETE" });
    setMkConn(null); setMkTemplates([]);
    setMkNote("Đã xoá mã khỏi web này. Mã vẫn còn hiệu lực trên MKT System tới khi hết hạn — hệ thống không thu hồi được.");
  };

  const mkLoadTemplates = async () => {
    setMkError("");
    try {
      const d = await mkFetchJson("/api/mkt/ad-templates?page=1&pageSize=50");
      setMkTemplates(d.items || []);
    } catch (e) { setMkError("❌ " + (e instanceof Error ? e.message : String(e))); }
  };

  const mkCreateTemplate = async () => {
    const errs = mkBlockErrors();
    if (errs.length) { setMkError("❌ " + errs.join("\n")); return; }
    setMkBusy("template"); setMkError(""); setMkNote("");
    try {
      await mkFetchJson("/api/mkt/ad-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: mkTplName.trim(), adContents: mkParseBlocks() }),
      });
      setMkNote(`✅ Đã tạo template "${mkTplName.trim()}".`);
      const origin = mkTplOriginRef.current;
      if (origin) setSdLocTplDone(prev => ({ ...prev, [origin]: mkTplName.trim() }));
      setMkTplName("");
      await mkLoadTemplates();
    } catch (e) { setMkError("❌ " + (e instanceof Error ? e.message : String(e))); }
    finally { setMkBusy(""); }
  };

  const mkTemplateAction = async (id: string, action: "duplicate" | "delete") => {
    setMkBusy(id); setMkError("");
    try {
      if (action === "duplicate") {
        await mkFetchJson("/api/mkt/ad-templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "duplicate", id }),
        });
      } else {
        await mkFetchJson(`/api/mkt/ad-templates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      }
      await mkLoadTemplates();
    } catch (e) { setMkError("❌ " + (e instanceof Error ? e.message : String(e))); }
    finally { setMkBusy(""); }
  };

  /** Fills the form from the Ad Copy Studio result — that is the whole point of having both. */
  const mkFillFromStudio = () => {
    if (!sdCopy) return;
    setMkTplName(`${sdAppName || "App"} — ${sdSelected || "Google Ad"}`.slice(0, 80));
    setMkBlocks([{
      headlines: sdCopy.headlines.slice(0, 5).join("\n"),
      descriptions: sdCopy.descriptions.slice(0, 5).join("\n"),
    }]);
    setMkNote("Đã điền từ Ad Copy Studio. Kiểm tra lại giới hạn ký tự trước khi tạo.");
  };

  const mkOnFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const read = (f: File) => new Promise<{name:string;dataUrl:string}>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, dataUrl: r.result as string });
      r.onerror = () => reject(new Error(`Không đọc được ${f.name}`));
      r.readAsDataURL(f);
    });
    try {
      const read_files = await Promise.all(Array.from(files).map(read));
      setMkFiles(prev => [...prev, ...read_files]);
    } catch (e) { setMkError("❌ " + (e instanceof Error ? e.message : String(e))); }
  };

  /** 800px webp preview, the size MKT System's own uploader makes. */
  const mkThumb = async (dataUrl: string): Promise<string | undefined> => {
    try {
      const img = await abLoadImg(dataUrl);
      const w = Math.min(800, img.width);
      const h = Math.max(1, Math.round((img.height / img.width) * w));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/webp", 0.85);
    } catch { return undefined; }
  };

  const mkUploadCreatives = async () => {
    const fromBanners = (abPrevRef.current.length ? abPrevRef.current : abPreviews)
      .filter(p => mkPicked.includes(p.key))
      .map(p => ({ name: `${abBrief?.app_name || "banner"}-${p.key}.png`, dataUrl: p.dataUrl }));
    const all = [...fromBanners, ...mkFiles];
    if (!all.length) { setMkError("❌ Chưa chọn file hoặc banner nào."); return; }

    setMkBusy("creative"); setMkError(""); setMkNote("");
    // One key per upload attempt, reused if this same set is sent again.
    if (!mkIdemRef.current) mkIdemRef.current = crypto.randomUUID();
    try {
      const items = await Promise.all(all.map(async f => ({
        name: f.name,
        dataUrl: f.dataUrl,
        thumbnailDataUrl: f.dataUrl.startsWith("data:image/") ? await mkThumb(f.dataUrl) : undefined,
        isPublic: mkPublic,
      })));
      const d = await mkFetchJson("/api/mkt/creatives", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, idempotencyKey: mkIdemRef.current }),
      });
      mkIdemRef.current = "";
      setMkPicked([]); setMkFiles([]);
      setMkNote(`✅ Đã đưa ${d.creatives?.length || 0} creative vào thư viện MKT System.` +
        (d.errors?.length ? `\n⚠️ Bỏ qua:\n${d.errors.join("\n")}` : ""));
    } catch (e) {
      // Key is deliberately kept: retrying with it is what prevents duplicates.
      setMkError("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally { setMkBusy(""); }
  };

  /* Picking straight from AI Banner and Ad Copy Studio, then a modal per the
   * integration guide, instead of carrying the selection over to the MKT tab. */
  const [mkModal, setMkModal] = useState<"creative"|"template"|null>(null);
  const [abMkSel, setAbMkSel] = useState<string[]>([]);
  const [sdSelH, setSdSelH] = useState<string[]>([]);
  const [sdSelD, setSdSelD] = useState<string[]>([]);
  /** Content picked per keyword; each entry becomes a block of the template. */
  const [sdBasket, setSdBasket] = useState<{keyword:string;headlines:string[];descriptions:string[]}[]>([]);
  /** Localized blocks per market, same block order as the basket at the time. */
  const [sdLocBlocks, setSdLocBlocks] = useState<{code:string;name:string;flag:string;language:string;keywords:string[];blocks:{headlines:string[];descriptions:string[]}[]}[]|null>(null);
  /** Market code → name of the template created for it. */
  const [sdLocTplDone, setSdLocTplDone] = useState<Record<string,string>>({});
  /** Market code the open template modal was started from, if any. */
  const mkTplOriginRef = useRef<string|null>(null);
  const [mkcNames, setMkcNames] = useState<Record<string,string>>({});
  const [mkcMeta, setMkcMeta] = useState({ tags: "", productIds: "", angleCodes: "", marketTargets: "", languages: "" });
  const [mkcStatus, setMkcStatus] = useState<Record<string,string>>({});
  /** S3 results per banner, kept so "Upload lại" only re-sends what failed. */
  const mkcPreparedRef = useRef<Record<string, Record<string, unknown>>>({});
  /** Idempotency-Key per bulk body: reused on a retry of the same body, new when the body changes. */
  const mkcIdemRef = useRef<{ body: string; key: string } | null>(null);
  const mkToggle = (setter: (fn: (prev: string[]) => string[]) => void, v: string) =>
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const mkOpenCreativeModal = () => {
    const base = (abBrief?.app_name || "banner").trim().replace(/\s+/g, "-");
    setMkcNames(Object.fromEntries(abMkSel.map(k => [k, `${base}-${k}`])));
    setMkcStatus({}); mkcPreparedRef.current = {}; mkcIdemRef.current = null;
    setMkError(""); setMkNote("");
    setMkModal("creative");
  };

  const mkUploadSelected = async () => {
    const pool = abPrevRef.current.length ? abPrevRef.current : abPreviews;
    const chosen = pool.filter(p => abMkSel.includes(p.key));
    if (!chosen.length) return;
    const list = (v: string) => v.split(",").map(x => x.trim()).filter(Boolean);
    const meta = {
      isPublic: mkPublic,
      tags: list(mkcMeta.tags), productIds: list(mkcMeta.productIds), angleCodes: list(mkcMeta.angleCodes),
      marketTargets: list(mkcMeta.marketTargets), languages: list(mkcMeta.languages),
    };
    setMkBusy("creative"); setMkError(""); setMkNote("");
    try {
      // One file per request: several PNG banners in one body would pass the
      // hosting platform's request-size limit. Two at a time.
      const queue = chosen.filter(p => !mkcPreparedRef.current[p.key]);
      const worker = async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const key = p.key;
          setMkcStatus(prev => ({ ...prev, [key]: "⏳ Đang upload..." }));
          try {
            const d = await mkFetchJson("/api/mkt/creatives", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mode: "upload", item: {
                name: `${(mkcNames[key] || key).trim()}.png`, dataUrl: p.dataUrl,
                thumbnailDataUrl: await mkThumb(p.dataUrl),
              } }),
            });
            mkcPreparedRef.current[key] = d.prepared;
            setMkcStatus(prev => ({ ...prev, [key]: "✓ Đã lên S3" }));
          } catch (e) {
            setMkcStatus(prev => ({ ...prev, [key]: "❌ " + (e instanceof Error ? e.message : String(e)) }));
          }
        }
      };
      await Promise.all([worker(), worker()]);
      const ready = chosen.filter(p => mkcPreparedRef.current[p.key]);
      if (ready.length < chosen.length) throw new Error("Một số ảnh upload lỗi. Bấm Upload lại để thử tiếp các ảnh lỗi.");

      // Name and metadata are applied here, so editing them after the S3 step still counts.
      const items = ready.map(p => ({ ...mkcPreparedRef.current[p.key], name: (mkcNames[p.key] || p.key).trim(), ...meta }));
      const body = JSON.stringify(items);
      if (mkcIdemRef.current?.body !== body) mkcIdemRef.current = { body, key: crypto.randomUUID() };
      const d = await mkFetchJson("/api/mkt/creatives", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "bulk", items, idempotencyKey: mkcIdemRef.current.key }),
      });
      mkcIdemRef.current = null; mkcPreparedRef.current = {};
      setAbMkSel([]);
      setMkNote(`✅ Đã đưa ${d.creatives?.length || 0} creative vào thư viện MKT System.` +
        (d.errors?.length ? `\n⚠️ Bỏ qua:\n${d.errors.join("\n")}` : ""));
    } catch (e) {
      setMkError("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally { setMkBusy(""); }
  };

  /** Adds the current keyword's picks as a block; picking again for the same keyword replaces it. */
  const sdAddToBasket = () => {
    if (!sdCopy || (!sdSelH.length && !sdSelD.length)) return;
    const entry = {
      keyword: sdSelected || "(không keyword)",
      headlines: sdCopy.headlines.filter(h => sdSelH.includes(h)),
      descriptions: sdCopy.descriptions.filter(d => sdSelD.includes(d)),
    };
    setSdBasket(prev => prev.some(b => b.keyword === entry.keyword)
      ? prev.map(b => b.keyword === entry.keyword ? entry : b)
      : [...prev, entry]);
  };

  /** One block per entry. An entry with more than 5 headlines is split evenly
   *  (6 → 3+3, not 5+1: a one-headline block blocks the campaign), its
   *  descriptions going with every part. */
  const mkSplitBlocks = (entries: {headlines:string[];descriptions:string[]}[]) => {
    const split = (a: string[]) => {
      const n = Math.max(1, Math.ceil(a.length / 5)), o: string[][] = [];
      for (let i = 0, at = 0; i < n; i++) { const size = Math.ceil((a.length - at) / (n - i)); o.push(a.slice(at, at + size)); at += size; }
      return o;
    };
    return entries.flatMap(b => {
      const hc = split(b.headlines), dc = split(b.descriptions);
      return hc.map((h, i) => ({ headlines: h, descriptions: dc[i] || dc[0] || [] }));
    });
  };

  const mkOpenTemplateFor = (entries: {headlines:string[];descriptions:string[]}[], name: string, origin: string | null) => {
    if (!entries.length) return;
    setMkBlocks(mkSplitBlocks(entries).map(b => ({ headlines: b.headlines.join("\n"), descriptions: b.descriptions.join("\n") })));
    setMkTplName(name.slice(0, 80));
    mkTplOriginRef.current = origin;
    setMkError(""); setMkNote("");
    setMkModal("template");
  };

  /**
   * Template names: "App | VI-VN | keyword +1 | 251001-1430".
   * The language-market tag sits in its own slot so typing "VI-VN" (or just
   * "VI-") in MKT System's template search lists every template for it; the
   * stamp keeps names unique, which MKT System requires.
   */
  const mkBuildTplName = (tag: string, keywords: string[], stamp: string) => {
    const app = (sdAppName || "App").trim().slice(0, 24);
    const kw = keywords.length ? keywords[0].slice(0, 28) + (keywords.length > 1 ? ` +${keywords.length - 1}` : "") : "copy";
    return `${app} | ${tag} | ${kw} | ${stamp}`;
  };
  const mkStamp = () => {
    const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
    return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };
  /** Tag of the copy as written: its language and the market picked for it. */
  const sdSourceTag = () => `${LANG_ISO[sdLang] || "XX"}-${COUNTRY_ISO[sdCountry] || "GLOBAL"}`;

  const mkOpenTemplateModal = () =>
    mkOpenTemplateFor(sdBasket, mkBuildTplName(sdSourceTag(), sdBasket.map(b => b.keyword), mkStamp()), null);

  /** One stamp per localize run, so a market's templates sort and search together. */
  const sdLocStampRef = useRef("");
  const sdLocTplName = (m: {code:string;keywords:string[]}) =>
    mkBuildTplName(`${MARKET_LANG_ISO[m.code] || "XX"}-${m.code}`, m.keywords, sdLocStampRef.current || mkStamp());

  /**
   * Localizes the picked blocks. One request per block, so each market's
   * answer keeps exactly that block's lines instead of relying on the model
   * to keep a flattened list in order.
   */
  const sdLocalizeBasket = async () => {
    if (!sdBasket.length || !sdLocMarkets.length) return;
    const basket = sdBasket;
    setSdLocLoading(true); setSdError(""); setSdLocBlocks(null); setSdLocTplDone({}); setMkNote(""); setMkError("");
    sdLocStampRef.current = mkStamp();
    try {
      const perBlock = await Promise.all(basket.map(async b => {
        const res = await fetch("/api/localize", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appName: sdAppName || sdUrl,
            headlines: b.headlines, descriptions: b.descriptions, ctas: [],
            markets: sdLocMarkets, sourceLanguage: sdLang,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Khối "${b.keyword}": ${data.error || "Localize thất bại."}`);
        return (data.results || []) as LocalizeMarketResult[];
      }));
      const markets = LOCALIZE_MARKETS.filter(m => sdLocMarkets.includes(m.code)).map(m => {
        const first = perBlock[0].find(r => r.code === m.code);
        return {
          code: m.code, name: m.name, flag: m.flag, language: first?.language || "",
          keywords: basket.map(b => b.keyword),
          blocks: perBlock.map(results => {
            const r = results.find(x => x.code === m.code);
            return { headlines: r?.headlines || [], descriptions: r?.descriptions || [] };
          }),
        };
      });
      setSdLocBlocks(markets);
    } catch (e) {
      setSdError("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSdLocLoading(false);
    }
  };

  /** Creates one template per localized market straight away, skipping ones that fail the campaign rule. */
  const sdCreateAllLocTemplates = async () => {
    if (!sdLocBlocks) return;
    if (!mkConn) { mkOpenTemplateFor(sdLocBlocks[0].blocks, sdLocTplName(sdLocBlocks[0]), sdLocBlocks[0].code); return; }
    setMkBusy("loc-all"); setMkError(""); setMkNote("");
    const done: string[] = [], failed: string[] = [];
    for (const m of sdLocBlocks) {
      if (sdLocTplDone[m.code]) continue;
      const blocks = mkSplitBlocks(m.blocks);
      const errs = mkValidate(blocks);
      if (errs.length) { failed.push(`${m.flag} ${m.code}: ${errs.join("; ")}`); continue; }
      try {
        await mkFetchJson("/api/mkt/ad-templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: sdLocTplName(m), adContents: blocks }),
        });
        setSdLocTplDone(prev => ({ ...prev, [m.code]: sdLocTplName(m) }));
        done.push(`${m.flag} ${m.code}`);
      } catch (e) {
        failed.push(`${m.flag} ${m.code}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (done.length) setMkNote(`✅ Đã tạo ${done.length} template: ${done.join(", ")}`);
    if (failed.length) setMkError("❌ Chưa tạo được:\n" + failed.join("\n"));
    setMkBusy("");
    void mkLoadTemplates();
  };

  interface HistoryItem { id: string; appName: string; date: string; thumbnail: string; count: number; }
  const [history, setHistory] = useState<HistoryItem[]>([]);
  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem("banner_history") || "[]")); } catch {}
  }, []);

  // Google sends the operator back here after the consent screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_ads_connected") === "1") {
      setActivePage("launch");
      checkAdsConnection();
      window.history.replaceState({}, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveHistory = (item: HistoryItem) => {
    setHistory(prev => {
      const next = [item, ...prev].slice(0, 20);
      try {
        // Compress thumbnail to small size before saving
        const canvas = document.createElement("canvas");
        const img = new Image(); img.src = item.thumbnail;
        canvas.width = 120; canvas.height = 63;
        const ctx = canvas.getContext("2d");
        img.onload = () => {
          ctx?.drawImage(img, 0, 0, 120, 63);
          const smallThumb = canvas.toDataURL("image/jpeg", 0.5);
          const compressed = next.map((h, i) => i === 0 ? {...h, thumbnail: smallThumb} : h);
          localStorage.setItem("banner_history", JSON.stringify(compressed));
          setHistory(compressed);
        };
        img.src = item.thumbnail;
      } catch {}
      return next;
    });
  };
  const deleteHistory = (id: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id);
      try { localStorage.setItem("banner_history", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [compQuery, setCompQuery] = useState("");
  const [compLoading, setCompLoading] = useState(false);
  const [compResult, setCompResult] = useState<Record<string, unknown> | null>(null);
  const [compError, setCompError] = useState("");
  const [compAppName, setCompAppName] = useState("");
  const [compAppIcon, setCompAppIcon] = useState("");
  const [compNameLoading, setCompNameLoading] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [countryOpen, setCountryOpen] = useState(false);
  const countryRef = useRef<HTMLDivElement>(null);
  const [langSearch, setLangSearch] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const isDark = darkMode;
  const t = {
    text:        isDark ? "#F1F5F9" : "#0F172A",
    textSub:     isDark ? "#94A3B8" : "#475569",
    textMuted:   isDark ? "#64748B" : "#94A3B8",
    border:      isDark ? "#1E293B" : "#E2E8F0",
    card:        isDark ? "#0F1117" : "#FFFFFF",
    cardHover:   isDark ? "#161B27" : "#F8FAFC",
    input:       isDark ? "#0F1117" : "#FFFFFF",
    inputBorder: isDark ? "#1E293B" : "#CBD5E1",
    progress:    isDark ? "#1E293B" : "#E2E8F0",
    tabBg:       isDark ? "#161B27" : "#F1F5F9",
    tabActive:   isDark ? "#1E293B" : "#FFFFFF",
    uploadHover: isDark ? "#161B27" : "#F8FAFC",
    cardShadow:  isDark ? "0 4px 24px rgba(0,0,0,0.4)" : "0 4px 24px rgba(109,40,217,0.07)",
    cardShadowHover: isDark ? "0 8px 40px rgba(0,0,0,0.5)" : "0 8px 40px rgba(109,40,217,0.13)",
    gradientOrb1: isDark ? "rgba(109,40,217,0.15)" : "rgba(139,92,246,0.08)",
    gradientOrb2: isDark ? "rgba(236,72,153,0.08)" : "rgba(236,72,153,0.05)",
  };

  const handleVideoChange = useCallback(async (file: File) => {
    setVideoFile(file); setError(""); setExtractProgress(10);
    try {
      setExtractProgress(20);
      const extracted = await extractFramesFromVideo(file, 8);
      setFrames(extracted); setExtractProgress(100);
    } catch { setError("Không thể đọc video. Thử file mp4 khác."); setExtractProgress(0); }
  }, []);

  const handleImagesChange = useCallback(async (files: FileList) => {
    const arr = Array.from(files).slice(0, 8);
    setImageFiles(arr); setError(""); setExtractProgress(10);
    try {
      const extracted: ExtractedFrame[] = await Promise.all(arr.map((f, i) => new Promise<ExtractedFrame>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve({ index: i, timestamp: i, dataUrl, base64: dataUrl.split(",")[1] });
        };
        reader.onerror = reject;
        reader.readAsDataURL(f);
      })));
      setFrames(extracted); setExtractProgress(100);
    } catch { setError("Không thể đọc ảnh. Thử file khác."); setExtractProgress(0); }
  }, []);

  const handleInpaint = async () => {
    const idx = brief.best_frame_index;
    if (!frames[idx]) return;
    setInpainting(true); setError("");
    try {
      const res = await fetch("/api/inpaint", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ imageBase64: frames[idx].dataUrl, language, country }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      // Replace the selected frame with the cleaned image
      const newFrames = frames.map((f, i) => i === idx ? { ...f, dataUrl: data.base64, base64: data.base64.split(",")[1] } : f);
      setFrames(newFrames);
    } catch(e) { setError(String(e)); }
    setInpainting(false);
  };

  const compressFrame = (dataUrl: string, maxSize = 512, quality = 0.5): Promise<string> =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.src = dataUrl;
    });

  const handleAnalyze = async () => {
    if (!frames.length) return;
    setStep("analyzing"); setError("");
    try {
      const indices = frames.length <= 4
        ? frames.map((_: unknown, i: number) => i)
        : [0, Math.floor(frames.length * 0.33), Math.floor(frames.length * 0.66), frames.length - 1];
      const selectedFrames = await Promise.all(
        indices.map(async (i: number) => ({ base64: await compressFrame(frames[i].dataUrl) }))
      );
      const res = await fetch("/api/analyze", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ selectedFrames, niche, language, country }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      const defaults = NICHE_DEFAULTS[niche] || {};
      setBrief(prev => ({ ...prev, ...defaults, ...data.brief, niche, app_store_url: prev.app_store_url, play_store_url: prev.play_store_url }));
      setStep("brief");
    } catch(e) { setError(String(e)); setStep("upload"); }
  };

  const handleGenerate = async () => {
    setStep("generating"); setError("");
    try {
      const bestIdx = Math.min(brief.best_frame_index ?? 0, frames.length - 1);
      const bgDataUrl = frames[bestIdx]?.dataUrl || null;
      const generated = await generateAllBanners(brief, bgDataUrl);
      setPreviews(generated);

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const top5 = zip.folder("top5")!;
      const all = zip.folder("all_sizes")!;
      for (const b of generated) {
        const base64 = b.dataUrl.split(",")[1];
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        if (b.isTop5) top5.file(`${b.key}.png`, bytes);
        all.file(`${b.key}.png`, bytes);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const reader = new FileReader();
      reader.onload = () => {
        const zip64 = (reader.result as string).split(",")[1];
        setZipBase64(zip64);
        const thumbnail = generated.find(p => p.isTop5)?.dataUrl || generated[0]?.dataUrl || "";
        saveHistory({ id: Date.now().toString(), appName: brief.app_name || "Untitled", date: new Date().toLocaleString("vi-VN"), thumbnail, count: generated.length });
      };
      reader.readAsDataURL(blob);
      setStep("preview");
    } catch(e) { setError(String(e)); setStep("brief"); }
  };

  const handleDownloadAll = () => { const a=document.createElement("a"); a.href=`data:application/zip;base64,${zipBase64}`; a.download=`google-ads-${brief.app_name||"banners"}.zip`; a.click(); };
  const handleDownloadSingle = (p: Preview) => { const a=document.createElement("a"); a.href=p.dataUrl; a.download=`${p.key}.png`; a.click(); };
  const displayedPreviews = activeTab==="top5" ? previews.filter(p=>p.isTop5) : previews;
  const resetAll = () => { setStep("upload"); setPreviews([]); setFrames([]); setVideoFile(null); setImageFiles([]); setIconFile(null); setError(""); setExtractProgress(0); };

  const inputStyle = { backgroundColor: t.input, borderColor: t.inputBorder, color: t.text, transition: "border-color 0.15s, box-shadow 0.15s" };
  const labelStyle = { color: t.textMuted };
  const cardStyle = { backgroundColor: t.card, borderColor: t.border, boxShadow: t.cardShadow, borderRadius: 16 };
  const cardStyleHover = { backgroundColor: t.card, borderColor: t.border, boxShadow: t.cardShadowHover, borderRadius: 16 };
  void cardStyleHover;

  const extractAppName = (url: string): { name: string; iosId?: string; androidPkg?: string } => {
    const iosSlugMatch = url.match(/apps\.apple\.com\/[^/]+\/app\/([^/]+)\/id(\d+)/);
    if (iosSlugMatch) return { name: iosSlugMatch[1].replace(/-/g, " "), iosId: iosSlugMatch[2] };
    const iosIdOnly = url.match(/apps\.apple\.com.*\/id(\d+)/);
    if (iosIdOnly) return { name: "", iosId: iosIdOnly[1] };
    const androidMatch = url.match(/id=([a-zA-Z0-9._]+)/);
    if (androidMatch) {
      const pkg = androidMatch[1];
      const parts = pkg.split(".");
      return { name: parts[parts.length - 1].replace(/_/g, " "), androidPkg: pkg };
    }
    return { name: url.trim() };
  };

  const handleCompetitorSearch = async () => {
    if (!compQuery.trim()) return;
    setCompLoading(true); setCompError("");
    try {
      const { name, iosId, androidPkg } = extractAppName(compQuery.trim());
      let finalName = name;

      if (iosId) {
        try {
          const res = await fetch(`https://itunes.apple.com/lookup?id=${iosId}`);
          const data = await res.json();
          if (data.results?.[0]?.trackName) finalName = data.results[0].trackName;
        } catch { /* dùng tên từ URL */ }
      } else if (androidPkg) {
        try {
          const res = await fetch("/api/app-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: androidPkg }) });
          const data = await res.json();
          if (data.name) finalName = data.name;
        } catch { /* dùng tên từ package */ }
      }

      if (!finalName || finalName.length < 3) {
        finalName = androidPkg?.split(".").pop()?.replace(/_/g, " ") || compQuery.trim();
      }
      const transparencyUrl = `https://adstransparency.google.com/?region=anywhere&query=${encodeURIComponent(finalName)}`;
      window.open(transparencyUrl, "_blank");
    } catch { setCompError("Không thể tra cứu tên app."); }
    finally { setCompLoading(false); }
  };

  const lookupAppNamePreview = async (url: string) => {
    const { name, iosId, androidPkg } = extractAppName(url);
    setCompAppName(name); setCompAppIcon("");
    if (!iosId && !androidPkg) return;
    setCompNameLoading(true);
    try {
      if (iosId) {
        const res = await fetch(`https://itunes.apple.com/lookup?id=${iosId}`);
        const data = await res.json();
        const app = data.results?.[0];
        if (app?.trackName) { setCompAppName(app.trackName); setCompAppIcon(app.artworkUrl60 || ""); }
      } else if (androidPkg) {
        const res = await fetch("/api/app-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: androidPkg }) });
        const data = await res.json();
        if (data.name) setCompAppName(data.name);
      }
    } catch { /* giữ tên từ URL */ }
    finally { setCompNameLoading(false); }
  };

  // Helper to render competitor creatives — unused now but kept for future
  const renderCompResult = () => {
    if (!compResult) return null;
    const creatives = (compResult.creatives as { creatives?: unknown[] } | null)?.creatives || [];
    const details = compResult.details as { name?: string; icon_url?: string; publisher_name?: string; global_rating_count?: number } | null;
    const network = compResult.network as { data?: { date: string; networks: { name: string; sov: number }[] }[] } | null;
    return (
      <div className="space-y-4 mt-4">
        {details && (
          <div className="flex items-center gap-3 p-3 rounded-xl border" style={{borderColor: t.border, backgroundColor: t.card}}>
            {details.icon_url && <img src={details.icon_url} alt="" className="w-10 h-10 rounded-xl"/>}
            <div>
              <div className="font-semibold text-sm" style={{color: t.text}}>{details.name}</div>
              <div className="text-xs" style={{color: t.textMuted}}>{details.publisher_name}</div>
              {details.global_rating_count && <div className="text-xs" style={{color: t.textMuted}}>⭐ {Number(details.global_rating_count).toLocaleString()} ratings</div>}
            </div>
          </div>
        )}
        {network?.data && network.data.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>Ad Networks (Share of Voice)</div>
            {network.data.slice(-1)[0]?.networks?.slice(0,5).map((n: {name:string;sov:number}, i: number) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <div className="text-xs w-24 truncate" style={{color: t.textSub}}>{n.name}</div>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{backgroundColor: t.progress}}>
                  <div className="h-full bg-violet-500 rounded-full" style={{width:`${Math.min(n.sov*100,100)}%`}}/>
                </div>
                <div className="text-xs w-10 text-right" style={{color: t.textMuted}}>{(n.sov*100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        )}
        {creatives.length > 0 ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>{creatives.length} Ad Creatives</div>
            <div className="grid grid-cols-2 gap-2">
              {(creatives as Array<{preview_url?:string;ad_type?:string;first_seen_date?:string;last_seen_date?:string;impression_share?:number}>).slice(0,6).map((c, i) => (
                <div key={i} className="rounded-xl overflow-hidden border" style={{borderColor: t.border}}>
                  {c.preview_url ? (
                    <img src={c.preview_url} alt="" className="w-full aspect-video object-cover"/>
                  ) : (
                    <div className="w-full aspect-video flex items-center justify-center text-xs" style={{backgroundColor: t.tabBg, color: t.textMuted}}>No preview</div>
                  )}
                  <div className="p-2 space-y-0.5" style={{backgroundColor: t.card}}>
                    <div className="text-xs font-medium capitalize" style={{color: t.text}}>{c.ad_type || "Display"}</div>
                    {c.first_seen_date && <div className="text-xs" style={{color: t.textMuted}}>First: {c.first_seen_date}</div>}
                    {c.last_seen_date && <div className="text-xs" style={{color: t.textMuted}}>Last: {c.last_seen_date}</div>}
                    {c.impression_share !== undefined && <div className="text-xs" style={{color: t.textMuted}}>SOV: {(c.impression_share*100).toFixed(1)}%</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-center py-4" style={{color: t.textMuted}}>Không có dữ liệu ad creatives<br/>(Cần SensorTower Ad Intelligence plan)</div>
        )}
      </div>
    );
  };
  void renderCompResult; void compError; void compResult;

  return (
    <div className="min-h-screen flex relative" style={{fontFamily:"Inter,-apple-system,sans-serif", backgroundColor: bgColor, color: t.text}}>
      {/* Gradient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{zIndex:0}}>
        <div style={{position:"absolute",top:"-10%",right:"5%",width:600,height:600,borderRadius:"50%",background:`radial-gradient(circle, ${t.gradientOrb1} 0%, transparent 70%)`,filter:"blur(40px)"}}/>
        <div style={{position:"absolute",bottom:"10%",left:"10%",width:400,height:400,borderRadius:"50%",background:`radial-gradient(circle, ${t.gradientOrb2} 0%, transparent 70%)`,filter:"blur(40px)"}}/>
      </div>
      <div className="min-h-screen flex w-full relative" style={{zIndex:1}}>

      {/* Fixed Sidebar */}
      <aside className="fixed top-0 left-0 h-full z-40 flex flex-col border-r" style={{width:200, backgroundColor: t.card, borderColor: t.border}}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{borderColor: t.border}}>
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="5" rx="1" fill="white" opacity="0.9"/><rect x="9" y="1" width="6" height="8" rx="1" fill="white" opacity="0.6"/><rect x="1" y="8" width="6" height="7" rx="1" fill="white" opacity="0.6"/><rect x="9" y="11" width="6" height="4" rx="1" fill="white" opacity="0.4"/></svg>
          </div>
          <div>
            <div className="text-xs font-bold leading-tight" style={{color: t.text}}>Ads Generator</div>
            <div className="text-[10px]" style={{color: t.textMuted}}>Apero Group</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          <div className="text-[9px] font-bold uppercase tracking-widest px-3 py-2" style={{color: t.textMuted}}>Công cụ</div>
          {([
            ["home",     "🏠", "Home"],
            ["generate", "🎨", "Gen Banner"],
            ["aibanner", "✨", "AI Banner"],
            ["studio",   "🎯", "Ad Copy Studio"],
            ["launch",   "🚀", "Launch Camp"],
            ["mkt",      "🔌", "MKT System"],
          ] as const).map(([page, icon, label]) => (
            <button key={page} onClick={() => { setActivePage(page); if (page==="generate") { setStep("upload"); } if (page==="launch") { checkAdsConnection(); } }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left"
              style={activePage===page
                ? {backgroundColor:"#7C3AED18", color:"#A78BFA", borderLeft:"2px solid #7C3AED", paddingLeft:10}
                : {color: t.textMuted, borderLeft:"2px solid transparent", paddingLeft:10}}>
              <span>{icon}</span>{label}
            </button>
          ))}
          <div className="text-[9px] font-bold uppercase tracking-widest px-3 py-2 mt-2" style={{color: t.textMuted}}>Upload</div>
    {([
      ["youtube", "▶️", "YouTube Upload"],
    ] as const).map(([page, icon, label]) => (
      <button key={page} onClick={() => setActivePage(page)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left"
        style={activePage===page
          ? {backgroundColor:"#7C3AED18", color:"#A78BFA", borderLeft:"2px solid #7C3AED", paddingLeft:10}
          : {color: t.textMuted, borderLeft:"2px solid transparent", paddingLeft:10}}>
        <span>{icon}</span>{label}
        {ytAuthenticated && <span className="ml-auto w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>}
      </button>
    ))}
    <div className="text-[9px] font-bold uppercase tracking-widest px-3 py-2 mt-2" style={{color: t.textMuted}}>Nghiên cứu</div>
          {([
            ["competitor", "🔍", "Competitor Ads"],
            ["history",   "🕐", "Lịch sử"],
          ] as const).map(([page, icon, label]) => (
            <button key={page} onClick={() => setActivePage(page)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left"
              style={activePage===page
                ? {backgroundColor:"#7C3AED18", color:"#A78BFA", borderLeft:"2px solid #7C3AED", paddingLeft:10}
                : {color: t.textMuted, borderLeft:"2px solid transparent", paddingLeft:10}}>
              <span>{icon}</span>{label}
              {page==="history" && history.length>0 && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{backgroundColor:"#10B98122",color:"#10B981"}}>{history.length}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom: user info + dark mode */}
        <div className="p-3 border-t space-y-2" style={{borderColor: t.border}}>
          {session?.user && (
            <div className="px-3 py-2 rounded-lg" style={{backgroundColor: t.tabBg}}>
              <div className="flex items-center gap-2 mb-1.5">
                {session.user.image
                  ? <img src={session.user.image} alt="" className="w-6 h-6 rounded-full flex-shrink-0"/>
                  : <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs flex-shrink-0">{(session.user.name||"?")[0].toUpperCase()}</div>
                }
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate" style={{color: t.text}}>{session.user.name || "User"}</div>
                  <div className="text-[10px] truncate" style={{color: t.textMuted}}>{session.user.email}</div>
                </div>
              </div>
              <button onClick={() => signOut({ callbackUrl: "/login" })}
                className="w-full text-[10px] px-2 py-1 rounded-md border transition-colors text-center"
                style={{borderColor: t.border, color: t.textMuted}}>
                Đăng xuất
              </button>
            </div>
          )}
          <button onClick={() => setDarkMode(d => !d)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all border"
            style={{color: t.textMuted, borderColor: t.border, backgroundColor: t.tabBg}}>
            {darkMode ? "☀️" : "🌙"} {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col" style={{marginLeft: 200}}>

      {/* Header */}
      <header className="border-b px-6 py-3.5 flex items-center justify-between" style={{borderColor: t.border}}>
        <div className="text-sm font-semibold" style={{color: t.text}}>
          {activePage==="home" ? "👋 Dashboard" : activePage==="generate" ? "🎨 Gen Banner" : activePage==="aibanner" ? "✨ AI Banner Design" : activePage==="competitor" ? "🔍 Competitor Ads" : activePage==="youtube" ? "▶️ YouTube Upload" : activePage==="studio" ? "🎯 Ad Copy Studio" : activePage==="mkt" ? "🔌 MKT System" : activePage==="launch" ? "🚀 Launch Campaign" : "🕐 Lịch sử"}
        </div>
        <div className="flex items-center gap-2">
          {activePage==="generate" && step !== "upload" && (
            <>
              <button onClick={() => { if (step==="preview") setStep("brief"); else if (step==="brief") setStep("upload"); else if (step==="analyzing") setStep("upload"); }}
                className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                style={{color: t.textMuted, borderColor: t.border}}>← Back</button>
              <button onClick={resetAll}
                className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                style={{color: t.textMuted, borderColor: t.border}}>🏠 Home</button>
            </>
          )}
          {activePage==="generate" && step==="upload" && (
            <button onClick={() => setActivePage("home")}
              className="text-xs px-3 py-1.5 rounded-md border transition-colors"
              style={{color: t.textMuted, borderColor: t.border}}>← Dashboard</button>
          )}
        </div>
      </header>

      {/* Progress bar */}
      {activePage === "generate" && (
        <div className="h-0.5" style={{backgroundColor: t.progress}}>
          <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500"
            style={{width: step==="upload"?"15%":step==="analyzing"?"40%":step==="brief"?"60%":step==="generating"?"80%":"100%"}}/>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-6 py-10">

        {/* HOME DASHBOARD */}
        {activePage === "home" && (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{color: t.text}}>Xin chào! 👋</h1>
              <p className="text-sm" style={{color: t.textMuted}}>Chọn công cụ để bắt đầu tạo quảng cáo</p>
            </div>

            {/* Tool cards */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{color: t.textMuted}}>Công cụ chính</div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { page: "generate" as const, icon: "🎨", name: "Gen Banner", desc: "Upload ảnh → AI tạo 20+ kích thước chuẩn Google Ads trong 60 giây", badge: "Phổ biến nhất", primary: true },
                  { page: "adcopy" as const,   icon: "✍️", name: "Ad Copy",    desc: "Tạo headline, description & CTA chuẩn Google Ads theo thị trường", badge: null, primary: false },
                  { page: "competitor" as const, icon: "🔍", name: "Competitor", desc: "Xem banner quảng cáo đối thủ đang chạy qua Google Ads Transparency", badge: null, primary: false },
                ].map(tool => (
                  <button key={tool.page} onClick={() => { setActivePage(tool.page); if (tool.page==="generate") setStep("upload"); }}
                    className="p-5 rounded-2xl border text-left transition-all hover:scale-[1.02]"
                    style={tool.primary
                      ? {backgroundColor:"#7C3AED12", borderColor:"#7C3AED44", boxShadow: t.cardShadow}
                      : {...cardStyle}}>
                    <div className="text-3xl mb-3">{tool.icon}</div>
                    <div className="text-sm font-bold mb-1" style={{color: t.text}}>{tool.name}</div>
                    <div className="text-xs leading-relaxed" style={{color: t.textMuted}}>{tool.desc}</div>
                    {tool.badge && (
                      <div className="mt-3 inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full" style={{backgroundColor:"#7C3AED22",color:"#A78BFA"}}>⭐ {tool.badge}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Recent history */}
            {history.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>Lần tạo gần đây</div>
                  <button onClick={() => setActivePage("history")} className="text-xs" style={{color:"#A78BFA"}}>Xem tất cả →</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {history.slice(0,3).map(h => (
                    <div key={h.id} className="rounded-xl border overflow-hidden" style={cardStyle}>
                      {h.thumbnail && <img src={h.thumbnail} alt="" className="w-full object-cover" style={{height:64}}/>}
                      <div className="p-3">
                        <div className="text-xs font-semibold truncate" style={{color: t.text}}>{h.appName || "Untitled"}</div>
                        <div className="text-[10px] mt-0.5" style={{color: t.textMuted}}>{h.date} · {h.count} ảnh</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* UPLOAD */}
        {activePage==="generate" && (step==="upload"||step==="analyzing") && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{color: t.text}}>Tạo ảnh Google Ads</h1>
              <p className="text-sm" style={{color: t.textMuted}}>Upload video hoặc ảnh → tự động gen {AD_SIZES.length} banner PNG cho Google UAC App Install</p>
            </div>

            {/* Niche */}
            <div className="p-5 border" style={cardStyle}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={labelStyle}>Ngành app</label>
              <div className="grid grid-cols-3 gap-3">
                {(["photo","tool","office"] as const).map(n => (
                  <button key={n} onClick={()=>setNiche(n)}
                    className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all ${niche===n?"border-violet-500 bg-violet-500/10 text-violet-400":""}`}
                    style={niche===n ? {} : {borderColor: t.border, color: t.textMuted}}>
                    {n==="photo"?"📸 Photo":n==="tool"?"🔧 Tool":"💼 Office"}
                  </button>
                ))}
              </div>
            </div>

            {/* Language + Country */}
            <div className="p-5 border grid grid-cols-2 gap-4" style={cardStyle}>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={labelStyle}>
                  🌐 Ngôn ngữ text trong ảnh
                </label>
                <div ref={langRef} className="relative">
                  <button type="button" onClick={() => { setLangOpen(o => !o); setLangSearch(""); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none transition-colors"
                    style={{...inputStyle, borderColor: langOpen ? "#7C3AED" : t.inputBorder}}>
                    <span>{LANGUAGES.find(l => l.code === language)?.label || language}</span>
                    <span className="text-xs ml-2" style={{color: t.textMuted}}>{langOpen ? "▲" : "▼"}</span>
                  </button>
                  {langOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                      <div className="p-2 border-b" style={{borderColor: t.border}}>
                        <input autoFocus value={langSearch} onChange={e => setLangSearch(e.target.value)}
                          placeholder="🔍 Tìm ngôn ngữ..."
                          className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500"
                          style={inputStyle}/>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {LANGUAGES.filter(l => l.label.toLowerCase().includes(langSearch.toLowerCase()) || l.code.toLowerCase().includes(langSearch.toLowerCase())).map(l => (
                          <button key={l.code} type="button"
                            onClick={() => { setLanguage(l.code); setLangOpen(false); setLangSearch(""); }}
                            className="w-full text-left px-4 py-2 text-sm transition-colors"
                            style={{backgroundColor: language === l.code ? "#7C3AED22" : "transparent", color: language === l.code ? "#A78BFA" : t.text}}>
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs mt-1.5" style={{color: t.textMuted}}>Headline, subheadline, CTA sẽ được viết bằng ngôn ngữ này</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={labelStyle}>
                  🎯 Thị trường mục tiêu
                </label>
                <div ref={countryRef} className="relative">
                  <button type="button" onClick={() => { setCountryOpen(o => !o); setCountrySearch(""); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none focus:border-violet-500 transition-colors"
                    style={{...inputStyle, borderColor: countryOpen ? "#7C3AED" : t.inputBorder}}>
                    <span>{COUNTRIES.find(c => c.code === country)?.label || country}</span>
                    <span className="text-xs ml-2" style={{color: t.textMuted}}>{countryOpen ? "▲" : "▼"}</span>
                  </button>
                  {countryOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                      <div className="p-2 border-b" style={{borderColor: t.border}}>
                        <input autoFocus value={countrySearch} onChange={e => setCountrySearch(e.target.value)}
                          placeholder="🔍 Tìm quốc gia..."
                          className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500"
                          style={inputStyle}/>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {COUNTRIES.filter(c => c.label.toLowerCase().includes(countrySearch.toLowerCase()) || c.code.toLowerCase().includes(countrySearch.toLowerCase())).map(c => (
                          <button key={c.code} type="button"
                            onClick={() => { setCountry(c.code); setCountryOpen(false); setCountrySearch(""); }}
                            className="w-full text-left px-4 py-2 text-sm transition-colors"
                            style={{backgroundColor: country === c.code ? "#7C3AED22" : "transparent", color: country === c.code ? "#A78BFA" : t.text}}>
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs mt-1.5" style={{color: t.textMuted}}>AI điều chỉnh màu sắc, tone & style phù hợp thị trường</p>
              </div>
            </div>

            {/* Input mode + upload */}
            <div className="p-5 border" style={cardStyle}>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold uppercase tracking-wider" style={labelStyle}>
                  Nguồn ảnh <span className="text-violet-400">*</span>
                </label>
                <div className="flex gap-1 rounded-lg p-0.5" style={{backgroundColor: t.tabBg}}>
                  {([["video","🎬 Video"],["image","🖼️ Ảnh tĩnh"]] as const).map(([mode, label])=>(
                    <button key={mode} onClick={()=>{setInputMode(mode);setFrames([]);setVideoFile(null);setImageFiles([]);setExtractProgress(0);}}
                      className="px-3 py-1 rounded-md text-xs font-medium transition-all"
                      style={inputMode===mode?{backgroundColor:t.tabActive,color:t.text}:{color:t.textMuted}}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {inputMode === "video" ? (
                <div onClick={()=>videoInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${videoFile?"border-violet-500/50 bg-violet-500/5":""}`}
                  style={videoFile ? {} : {borderColor: t.border}}
                  onMouseEnter={e => { if (!videoFile) (e.currentTarget as HTMLDivElement).style.backgroundColor = t.uploadHover; }}
                  onMouseLeave={e => { if (!videoFile) (e.currentTarget as HTMLDivElement).style.backgroundColor = ""; }}>
                  {videoFile ? (
                    <div className="space-y-2">
                      <div className="text-2xl">🎬</div>
                      <div className="text-sm font-medium" style={{color: t.text}}>{videoFile.name}</div>
                      <div className="text-xs" style={{color: t.textMuted}}>{(videoFile.size/1024/1024).toFixed(1)} MB</div>
                      {extractProgress>0&&extractProgress<100&&(
                        <div className="mt-3">
                          <div className="h-1 rounded-full overflow-hidden" style={{backgroundColor: t.border}}>
                            <div className="h-full bg-violet-500 transition-all duration-300" style={{width:`${extractProgress}%`}}/>
                          </div>
                          <div className="text-xs mt-1" style={{color: t.textMuted}}>Đang extract frames...</div>
                        </div>
                      )}
                      {extractProgress===100&&<div className="text-xs text-emerald-500">✓ Extracted {frames.length} frames</div>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-3xl opacity-40">🎬</div>
                      <div className="text-sm" style={{color: t.textMuted}}>Click để upload video ads</div>
                      <div className="text-xs" style={{color: t.textMuted, opacity: 0.7}}>MP4, MOV, AVI, WebM</div>
                    </div>
                  )}
                  <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={e=>e.target.files?.[0]&&handleVideoChange(e.target.files[0])}/>
                </div>
              ) : (
                <div onClick={()=>imageInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${imageFiles.length?"border-violet-500/50 bg-violet-500/5":""}`}
                  style={imageFiles.length ? {} : {borderColor: t.border}}
                  onMouseEnter={e => { if (!imageFiles.length) (e.currentTarget as HTMLDivElement).style.backgroundColor = t.uploadHover; }}
                  onMouseLeave={e => { if (!imageFiles.length) (e.currentTarget as HTMLDivElement).style.backgroundColor = ""; }}>
                  {imageFiles.length ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2 justify-center">
                        {frames.map((f,i)=>(
                          <img key={i} src={f.dataUrl} alt={`img${i}`} className="w-16 h-16 object-cover rounded-lg border" style={{borderColor:t.border}}/>
                        ))}
                      </div>
                      <div className="text-xs text-emerald-500">✓ {imageFiles.length} ảnh đã tải lên</div>
                      <div className="text-xs" style={{color: t.textMuted}}>Click để thay đổi</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-3xl opacity-40">🖼️</div>
                      <div className="text-sm" style={{color: t.textMuted}}>Click để upload 1–8 ảnh</div>
                      <div className="text-xs" style={{color: t.textMuted, opacity: 0.7}}>PNG, JPG, WebP</div>
                    </div>
                  )}
                  <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>e.target.files&&e.target.files.length>0&&handleImagesChange(e.target.files)}/>
                </div>
              )}
            </div>

            {/* Icon + Store links */}
            <div className="p-5 border grid grid-cols-2 gap-4" style={cardStyle}>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={labelStyle}>
                  Icon app <span className="font-normal normal-case" style={{color: t.textMuted}}>(tuỳ chọn)</span>
                </label>
                <div onClick={()=>iconInputRef.current?.click()}
                  className={`border border-dashed rounded-xl p-5 text-center cursor-pointer transition-all h-[88px] flex flex-col items-center justify-center gap-1 ${iconFile?"border-violet-500/40 bg-violet-500/5":""}`}
                  style={iconFile ? {} : {borderColor: t.border}}>
                  {iconFile ? (
                    <><div className="text-xl">🔷</div><div className="text-xs truncate max-w-[140px]" style={{color: t.text}}>{iconFile.name}</div></>
                  ) : (
                    <><div className="text-xl opacity-30">🔷</div><div className="text-xs" style={{color: t.textMuted}}>Upload icon PNG/JPG</div></>
                  )}
                  <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={e=>e.target.files?.[0]&&setIconFile(e.target.files[0])}/>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={labelStyle}>
                  Store links <span className="font-normal normal-case" style={{color: t.textMuted}}>(tuỳ chọn)</span>
                </label>
                <input type="url" placeholder="🍎 App Store URL" value={brief.app_store_url} onChange={e=>setBrief(p=>({...p,app_store_url:e.target.value}))}
                  className="w-full rounded-lg px-3 py-2 text-xs border focus:outline-none focus:border-violet-500/50 transition-colors" style={inputStyle}/>
                <input type="url" placeholder="🤖 Google Play URL" value={brief.play_store_url} onChange={e=>setBrief(p=>({...p,play_store_url:e.target.value}))}
                  className="w-full rounded-lg px-3 py-2 text-xs border focus:outline-none focus:border-violet-500/50 transition-colors" style={inputStyle}/>
              </div>
            </div>

            {error&&<p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-3">{error}</p>}
            <button onClick={handleAnalyze} disabled={frames.length===0||step==="analyzing"}
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white">
              {step==="analyzing"?<span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Đang phân tích...</span>:"Phân tích & tạo brief →"}
            </button>
          </div>
        )}

        {/* BRIEF */}
        {activePage==="generate" && step==="brief" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1" style={{color: t.text}}>Xem lại & chỉnh brief</h2>
              <p className="text-sm" style={{color: t.textMuted}}>Claude đã phân tích. Chỉnh bất kỳ mục nào trước khi gen ảnh.</p>
            </div>

            {/* Frame selector */}
            <div className="p-5 border" style={cardStyle}>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold uppercase tracking-wider" style={labelStyle}>
                  Frame background ({brief.best_frame_index+1}/{frames.length})
                </label>
                <button onClick={handleInpaint} disabled={inpainting}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all disabled:opacity-40"
                  style={{borderColor:"rgba(139,92,246,0.5)", color:"#a78bfa", backgroundColor:"rgba(139,92,246,0.08)"}}
                  title="Dùng AI xóa text gốc trong ảnh (OpenAI)">
                  {inpainting ? <><span className="animate-spin">⏳</span> Đang xử lý...</> : <>✨ Xóa text gốc (AI)</>}
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {frames.map((f,i)=>(
                  <button key={i} onClick={()=>setBrief(p=>({...p,best_frame_index:i}))}
                    className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${brief.best_frame_index===i?"border-violet-500 scale-105":""}`}
                    style={brief.best_frame_index===i ? {} : {borderColor: t.border, opacity: 0.6}}>
                    <img src={f.dataUrl} alt={`Frame ${i}`} className="w-24 h-14 object-cover"/>
                  </button>
                ))}
              </div>
              <p className="text-xs mt-2" style={{color: t.textMuted}}>Chọn frame → click "Xóa text gốc" để AI xóa text trong ảnh đó (~$0.04)</p>
            </div>

            {/* Text fields */}
            <div className="p-5 border grid grid-cols-2 gap-4" style={cardStyle}>
              {[{key:"app_name",label:"Tên app",placeholder:"e.g. PhotoPro"},{key:"cta_text",label:"CTA Button",placeholder:"e.g. Try Free"},{key:"headline",label:"Headline",placeholder:"e.g. Edit Photos Like a Pro",full:true},{key:"subheadline",label:"Subheadline",placeholder:"e.g. 100+ Filters & AI Tools",full:true}].map(field=>(
                <div key={field.key} className={field.full?"col-span-2":""}>
                  <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>{field.label}</label>
                  <input type="text" placeholder={field.placeholder}
                    value={(brief as unknown as Record<string,string>)[field.key]||""}
                    onChange={e=>setBrief(p=>({...p,[field.key]:e.target.value}))}
                    className="w-full rounded-lg px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500/60 transition-colors"
                    style={inputStyle}/>
                </div>
              ))}
            </div>

            {/* Colors */}
            <div className="p-5 border" style={cardStyle}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={labelStyle}>Màu sắc</label>
              <div className="flex gap-6">
                {[{key:"primary_color",label:"Primary"},{key:"secondary_color",label:"Secondary"},{key:"accent_color",label:"Accent (CTA)"}].map(c=>(
                  <div key={c.key} className="flex items-center gap-2">
                    <input type="color" value={(brief as unknown as Record<string,string>)[c.key]||"#7B2FBE"} onChange={e=>setBrief(p=>({...p,[c.key]:e.target.value}))}
                      className="w-8 h-8 rounded cursor-pointer border" style={{borderColor: t.border}}/>
                    <span className="text-xs" style={{color: t.textMuted}}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {error&&<p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-3">{error}</p>}
            <button onClick={handleGenerate} className="w-full py-3.5 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 transition-all text-white">
              Gen {AD_SIZES.length} banner PNG →
            </button>
          </div>
        )}

        {/* GENERATING */}
        {activePage==="generate" && step==="generating" && (
          <div className="text-center py-20 space-y-6">
            <div className="text-5xl animate-pulse">🎨</div>
            <div>
              <h2 className="text-xl font-bold mb-2" style={{color: t.text}}>Đang tạo {AD_SIZES.length} banner...</h2>
              <p className="text-sm" style={{color: t.textMuted}}>Đang composite ảnh cho tất cả kích thước Google Ads</p>
            </div>
            <div className="w-48 h-1 rounded-full overflow-hidden mx-auto" style={{backgroundColor: t.border}}>
              <div className="h-full bg-violet-500 animate-pulse w-2/3"/>
            </div>
          </div>
        )}

        {/* PREVIEW */}
        {activePage==="generate" && step==="preview" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold mb-1" style={{color: t.text}}>✅ {previews.length} banner đã sẵn sàng</h2>
                <p className="text-sm" style={{color: t.textMuted}}>Click ảnh để xem lớn · hover để download riêng</p>
              </div>
              <button onClick={handleDownloadAll} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 transition-all text-white text-sm font-semibold px-4 py-2.5 rounded-xl">
                ⬇ Tải tất cả (.zip)
              </button>
            </div>
            <div className="flex gap-1 rounded-xl p-1 w-fit" style={{backgroundColor: t.tabBg}}>
              {([["top5","⭐ Top 5"],["all",`Tất cả (${previews.length})`],["device","📱 Device Preview"]] as const).map(([tab,label])=>(
                <button key={tab} onClick={()=>setActiveTab(tab)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={activeTab===tab ? {backgroundColor: t.tabActive, color: t.text} : {color: t.textMuted}}>
                  {label}
                </button>
              ))}
            </div>
            {/* Device Preview Tab */}
            {activeTab === "device" && (() => {
              const allP = previews;
              const cur = allP[devicePreviewIndex] || allP[0];
              const isPortrait = cur && cur.height > cur.width;
              const isSquare = cur && cur.width === cur.height;
              return (
                <div className="space-y-6">
                  {/* Device selector */}
                  <div className="flex items-center gap-3">
                    {(["phone","tablet"] as const).map(d => (
                      <button key={d} onClick={() => setDeviceType(d)}
                        className="px-4 py-1.5 rounded-lg text-sm font-medium border transition-all"
                        style={deviceType===d ? {backgroundColor:"#7C3AED22",borderColor:"#7C3AED",color:"#A78BFA"} : {borderColor:t.border,color:t.textMuted}}>
                        {d==="phone"?"📱 Phone":"📟 Tablet"}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col lg:flex-row gap-8 items-start">
                    {/* Mockup */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-4">
                      {/* Phone frame */}
                      {deviceType === "phone" ? (
                        <div className="relative rounded-[2.5rem] border-[6px] shadow-2xl overflow-hidden flex-shrink-0"
                          style={{width:220, height:440, borderColor: isDark?"#334155":"#1E293B", backgroundColor:"#0F172A"}}>
                          {/* Notch */}
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 rounded-b-xl z-10" style={{backgroundColor: isDark?"#334155":"#1E293B"}}/>
                          {/* Screen */}
                          <div className="w-full h-full overflow-hidden flex flex-col" style={{backgroundColor:"#F8FAFC"}}>
                            {/* Status bar */}
                            <div className="flex items-center justify-between px-5 pt-6 pb-1 text-xs font-medium" style={{color:"#0F172A"}}>
                              <span>9:41</span><span>●●●</span>
                            </div>
                            {/* App-like content above ad — thu nhỏ lại nếu portrait */}
                            {!isPortrait && (
                              <div className="flex-1 px-2 py-1 space-y-1.5 overflow-hidden">
                                {[80,60,70].map((w,i)=>(
                                  <div key={i} className="h-2 rounded-full" style={{width:`${w}%`,backgroundColor:"#E2E8F0"}}/>
                                ))}
                                <div className="h-16 rounded-lg mt-2" style={{backgroundColor:"#E2E8F0"}}/>
                                <div className="h-2 rounded-full w-4/5" style={{backgroundColor:"#E2E8F0"}}/>
                                <div className="h-2 rounded-full w-3/5" style={{backgroundColor:"#E2E8F0"}}/>
                              </div>
                            )}
                            {/* Ad banner — scale đúng tỉ lệ, phone inner width ~196px */}
                            {cur && (() => {
                              const innerW = 196;
                              const ratio = cur.height / cur.width;
                              const adH = Math.round(innerW * ratio);
                              const maxAdH = isPortrait ? 320 : isSquare ? 196 : 103;
                              return (
                                <div className="relative mx-1 mb-1 overflow-hidden rounded-lg shadow" style={{flexShrink:0, height: Math.min(adH, maxAdH)}}>
                                  <div className="absolute top-0.5 right-0.5 bg-black/50 text-white px-1 rounded z-10" style={{fontSize:8}}>Ad</div>
                                  <img src={cur.dataUrl} alt="" style={{width:"100%", height:"100%", objectFit:"cover", objectPosition:"top"}}/>
                                </div>
                              );
                            })()}
                          </div>
                          {/* Home bar */}
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full" style={{backgroundColor:"#334155"}}/>
                        </div>
                      ) : (
                        /* Tablet frame */
                        <div className="relative rounded-[1.5rem] border-[6px] shadow-2xl overflow-hidden"
                          style={{width:320, height:440, borderColor: isDark?"#334155":"#1E293B", backgroundColor:"#0F172A"}}>
                          <div className="w-full h-full overflow-hidden flex flex-col" style={{backgroundColor:"#F8FAFC"}}>
                            <div className="flex items-center justify-between px-4 pt-3 pb-1 text-xs font-medium" style={{color:"#0F172A"}}>
                              <span>9:41</span><span>●●● 100%</span>
                            </div>
                            <div className="flex-1 px-3 py-2 grid grid-cols-2 gap-2 overflow-hidden">
                              {[1,2,3,4].map(i=>(
                                <div key={i} className="rounded-lg" style={{backgroundColor:"#E2E8F0",height:80}}/>
                              ))}
                            </div>
                            {cur && (() => {
                              const innerW = 296;
                              const ratio = cur.height / cur.width;
                              const adH = Math.round(innerW * ratio);
                              const maxAdH = isPortrait ? 380 : isSquare ? 296 : 155;
                              return (
                                <div className="relative mx-2 mb-2 overflow-hidden rounded-lg shadow" style={{flexShrink:0, height: Math.min(adH, maxAdH)}}>
                                  <div className="absolute top-0.5 right-0.5 bg-black/50 text-white px-1 rounded z-10" style={{fontSize:8}}>Ad</div>
                                  <img src={cur.dataUrl} alt="" style={{width:"100%", height:"100%", objectFit:"cover", objectPosition:"top"}}/>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                      <div className="text-xs text-center" style={{color:t.textMuted}}>
                        {cur?.label} · {cur?.width}×{cur?.height}px
                      </div>
                    </div>

                    {/* Banner selector list */}
                    <div className="flex-1 grid grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                      {allP.map((p,i) => (
                        <button key={p.key} onClick={() => setDevicePreviewIndex(i)}
                          className="rounded-lg border p-2 text-left transition-all"
                          style={{borderColor: devicePreviewIndex===i?"#7C3AED":t.border, backgroundColor: devicePreviewIndex===i?"#7C3AED11":t.card}}>
                          <img src={p.dataUrl} alt="" className="w-full rounded mb-1 object-cover" style={{height:40}}/>
                          <div className="text-xs font-medium truncate" style={{color: devicePreviewIndex===i?"#A78BFA":t.text}}>{p.key}</div>
                          <div className="text-xs truncate" style={{color:t.textMuted}}>{p.width}×{p.height}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Banner grid */}
            {activeTab !== "device" && <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {displayedPreviews.map(p=>{
                const scale=Math.min(1,340/Math.max(p.width,p.height));
                return (
                  <div key={p.key} onClick={()=>setSelectedPreview(p)}
                    className="group rounded-2xl p-4 cursor-pointer transition-all border"
                    style={{...cardStyle, transition:"box-shadow 0.2s, border-color 0.2s, background-color 0.2s"}}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = t.cardShadowHover; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(139,92,246,0.4)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = t.cardShadow; (e.currentTarget as HTMLDivElement).style.borderColor = t.border; }}>
                    <div className="flex items-center justify-center mb-3" style={{height:Math.round(p.height*scale)+16}}>
                      <img src={p.dataUrl} alt={p.label} style={{width:Math.round(p.width*scale),height:Math.round(p.height*scale)}} className="rounded shadow-lg"/>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold" style={{color: t.text}}>{p.key}</div>
                        <div className="text-xs" style={{color: t.textMuted}}>{p.label}</div>
                      </div>
                      <button onClick={e=>{e.stopPropagation();handleDownloadSingle(p);}}
                        className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-lg transition-all hover:bg-violet-600 hover:text-white"
                        style={{backgroundColor: t.tabBg, color: t.textSub}}>
                        ⬇
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>
        )}

        {/* AUTO GEN PAGE */}
        {activePage === "aibanner" && (
          <div className="space-y-6 max-w-2xl">
            <div className="flex items-center gap-2 text-xs" style={{color: t.textMuted}}>
              {([["input","1","Nhập thông tin"],["generating","2","AI tạo ảnh"],["preview","3","Kết quả"]] as [AbStep,string,string][]).map(([s,n,label],i) => {
                const order: AbStep[] = ["input","generating","preview"];
                const done = order.indexOf(abStep) > order.indexOf(s), active = abStep === s;
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${active?"bg-violet-600 text-white":done?"bg-violet-600/40 text-violet-400":""}`}
                      style={!active&&!done?{backgroundColor:t.tabBg,color:t.textMuted}:{}}>{n}</span>
                    <span style={active?{color:"#A78BFA"}:{}}>{label}</span>
                    {i<2&&<span>→</span>}
                  </div>
                );
              })}
              <button onClick={() => { setAbHistOpen(o => !o); void abRefreshHistory(); }}
                className="ml-auto text-xs px-3 py-1.5 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>
                🕐 Lịch sử gen {abHistory.length > 0 && `(${abHistory.length})`}
              </button>
            </div>

            {abHistOpen && (
              /* The artwork is kept, not the finished PNGs: reopening redraws
                 the copy onto it, which is what makes localising an old set
                 cost a text call instead of a new generation. */
              <div className="p-4 border rounded-2xl space-y-3" style={cardStyle}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>🕐 Lần gen đã lưu</span>
                  <span className="text-[11px]" style={{color: t.textMuted}}>Mở lại để xem hoặc localize — không tốn tiền gen ảnh</span>
                </div>
                {abHistory.length === 0 ? (
                  <p className="text-xs" style={{color: t.textMuted}}>Chưa có lần gen nào được lưu. Gen xong một bộ là nó tự lưu vào đây.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {abHistory.map(r => (
                      <div key={r.id} className="flex items-center gap-3 p-2 rounded-xl border" style={{borderColor: t.border}}>
                        {r.thumb
                          ? <img src={r.thumb} alt="" className="w-16 h-12 object-cover rounded-lg flex-shrink-0"/>
                          : <div className="w-16 h-12 rounded-lg flex-shrink-0" style={{backgroundColor: t.tabBg}}/>}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate" style={{color: t.text}}>{r.appName || "(không tên)"}</div>
                          <div className="text-[11px] truncate" style={{color: t.textMuted}}>
                            {new Date(r.createdAt).toLocaleString("vi-VN")} · {r.country} · {r.language} · {r.slotCount} ảnh
                          </div>
                        </div>
                        <button onClick={() => handleAbOpenRun(r)} disabled={abHistBusy !== ""}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex-shrink-0">
                          {abHistBusy === r.id ? "⏳" : "Mở lại"}
                        </button>
                        <button onClick={() => handleAbDeleteRun(r.id)} title="Xoá khỏi lịch sử"
                          className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0" style={{backgroundColor: t.tabBg, color: t.textMuted}}>🗑</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {abStep === "input" && (
              <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>
                    🔗 URL App Store / Play Store <span className="text-violet-400">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input value={abUrl}
                      onChange={e => { setAbUrl(e.target.value); setAbFetched(null); }}
                      onKeyDown={e => { if (e.key === "Enter") handleAbFetch(); }}
                      placeholder="https://play.google.com/store/apps/details?id=... hoặc https://apps.apple.com/..."
                      className="flex-1 min-w-0 text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                    <button onClick={handleAbFetch} disabled={!abUrl.trim() || abFetching}
                      className="flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                      {abFetching
                        ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/>Đang lấy...</>
                        : <>🔍 Kiểm tra</>}
                    </button>
                  </div>

                  {abFetched && (
                    <div className="mt-2.5 flex items-center gap-3 p-2.5 rounded-xl border" style={{borderColor:"#10B98144", backgroundColor:"#10B9810F"}}>
                      {abFetched.icon
                        ? <img src={abFetched.icon} alt="" className="w-11 h-11 rounded-xl flex-shrink-0"/>
                        : <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-lg" style={{backgroundColor:t.tabBg}}>📱</div>}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate" style={{color:t.text}}>{abFetched.name}</div>
                        <div className="text-xs" style={{color:t.textMuted}}>
                          {abFetched.shots} screenshot
                          {abFetched.genre && <> · {abFetched.genre}</>}
                          {abFetched.cc && <> · store {abFetched.cc.toUpperCase()}</>}
                        </div>
                      </div>
                      <span className="text-emerald-500 text-lg flex-shrink-0">✓</span>
                    </div>
                  )}
                </div>

                {/* Market first: the creative direction is written FOR a market,
                    and choosing it afterwards is what left a Vietnamese headline
                    on a German campaign. */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Thị trường</label>
                    <select value={abCountry} onChange={e => { setAbCountry(e.target.value); const dl = COUNTRY_DEFAULT_LANG[e.target.value]; if (dl) setAbLang(dl); }}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500" style={inputStyle}>
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Ngôn ngữ ad copy</label>
                    <select value={abLang} onChange={e => setAbLang(e.target.value)}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500" style={inputStyle}>
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>💡 Creative direction</label>
                    {/* Keep a filled background while loading: a transparent one
                        left white text on a white card, so the spinner vanished
                        and the button looked like it had done nothing. */}
                    <button onClick={handleAbAutoPrompt} disabled={!abUrl.trim() || abPromptLoading}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-white disabled:cursor-not-allowed"
                      style={{background: abPromptLoading ? "#A78BFA" : "linear-gradient(135deg,#7C3AED,#EC4899)", opacity: !abUrl.trim() && !abPromptLoading ? 0.4 : 1, border: "none"}}>
                      {abPromptLoading
                        ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>Đang tạo...</>
                        : <>✨ Auto Prompt</>}
                    </button>
                  </div>

                  {abPromptLoading && (
                    <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{backgroundColor:"#7C3AED14", color:"#A78BFA"}}>
                      <span className="inline-block w-3 h-3 border-2 rounded-full animate-spin flex-shrink-0" style={{borderColor:"#A78BFA", borderTopColor:"transparent"}}/>
                      <span>{abPromptStep || "Đang xử lý..."}</span>
                      <span className="ml-auto flex-shrink-0" style={{color:t.textMuted}}>có thể mất 10-40s</span>
                    </div>
                  )}

                  <textarea value={abPrompt} onChange={e => setAbPrompt(e.target.value)} rows={14}
                    disabled={abPromptLoading}
                    placeholder={"Bấm ✨ Auto Prompt để GPT viết brief chi tiết, hoặc tự viết theo mẫu:\n\nBỐ CỤC\n- Nhân vật: ...\n- Phone mockup: ...\n- Đạo cụ: ...\n\nTEXT TRÊN BANNER\n- Headline: \"...\"\n- Phụ đề: \"...\"\n\nCTA\n- Nút: \"...\""}
                    className="w-full text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500 resize-y disabled:opacity-60"
                    style={{...inputStyle, minHeight: 240, lineHeight: "1.65", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5}}/>
                  {abPrompt.trim() && abPromptLang && abPromptLang !== abLang && (
                    /* The direction quotes the headline and CTA in the language
                       it was written for. Generating now would carry that copy
                       into a campaign for a different market. */
                    <p className="text-[11px] mt-1.5 px-2.5 py-1.5 rounded-lg" style={{backgroundColor:"#F59E0B14", color:"#F59E0B"}}>
                      ⚠️ Creative direction này viết cho ad copy <b>{abPromptLang}</b>, nhưng bạn đang chọn <b>{abLang}</b>.
                      Bấm ✨ Auto Prompt lại để viết theo <b>{abLang}</b>, nếu không chữ trên banner có thể ra sai ngôn ngữ.
                    </p>
                  )}
                </div>

                {/* Mascot — the consistency anchor across all sizes */}
                <div className="rounded-xl border p-3 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                  <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer" style={{color: t.text}}>
                    <input type="checkbox" checked={abAutoMascot} onChange={e => setAbAutoMascot(e.target.checked)} className="h-4 w-4 accent-violet-500"/>
                    🤖 Tự động tìm / tạo mascot
                  </label>
                  <p className="text-xs pl-6" style={{color: t.textMuted}}>Tìm nhân vật trong screenshots của app; không có thì tự tạo, rồi tái dùng cho mọi size.</p>
                  <div className="flex items-center gap-3 pl-6">
                    {(abCharacter || abMascotUsed)
                      ? <img src={(abCharacter || abMascotUsed) as string} alt="mascot" className="h-14 w-14 rounded-lg object-cover flex-shrink-0"/>
                      : <div className="h-14 w-14 flex items-center justify-center rounded-lg border border-dashed text-2xl flex-shrink-0" style={{borderColor: t.border}}>🤖</div>}
                    <div className="flex-1 space-y-1">
                      <p className="text-xs" style={{color: t.textMuted}}>
                        {abCharacter ? "Đang dùng mascot bạn upload." : abMascotUsed ? "Mascot dùng lần gen gần nhất." : "Tùy chọn: upload ảnh để ghi đè auto."}
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => abCharRef.current?.click()} className="text-xs px-3 py-1 rounded-md" style={{backgroundColor: t.border, color: t.text}}>Chọn ảnh</button>
                        {abCharacter && <button onClick={() => setAbCharacter(null)} className="text-xs px-3 py-1 rounded-md" style={{backgroundColor: t.border, color: t.text}}>Bỏ override</button>}
                      </div>
                      <input ref={abCharRef} type="file" accept="image/*" hidden onChange={e => { const f=e.target.files?.[0]; if(f){const r=new FileReader(); r.onload=()=>setAbCharacter(r.result as string); r.readAsDataURL(f);} }}/>
                    </div>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{color: t.text}}>
                  <input type="checkbox" checked={abUseScreenshot} onChange={e => setAbUseScreenshot(e.target.checked)} className="h-4 w-4 accent-violet-500"/>
                  📱 Dùng screenshot thật của app làm reference
                </label>

                <div className="rounded-xl border p-3 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                  <div className="text-sm font-semibold" style={{color: t.text}}>🎯 Phạm vi gen</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      ["one",  "1 ảnh duyệt", "Xem thử rồi quyết"],
                      ["core", "3 ảnh",        "1 cho mỗi tỉ lệ"],
                      ["full", `${APP_CREATIVES.length} creative`, "Đủ bộ để upload"],
                    ] as const).map(([m, title, sub]) => (
                      <button key={m} onClick={() => setAbMode(m)}
                        className="rounded-lg px-2 py-2 text-left border transition-all"
                        style={abMode === m
                          ? {borderColor:"#7C3AED", backgroundColor:"#7C3AED14"}
                          : {borderColor:t.border, backgroundColor:"transparent"}}>
                        <div className="text-xs font-semibold" style={{color: abMode === m ? "#A78BFA" : t.text}}>{title}</div>
                        <div className="text-[10px] mt-0.5" style={{color:t.textMuted}}>{sub}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs" style={{color: t.textMuted}}>
                    {abMode === "one"
                      ? "Gen 1 ảnh vuông để duyệt. Ưng thì bấm gen đủ bộ ngay ở bước kết quả — brief và mascot dùng lại, không mất tiền lần nữa."
                      : abMode === "core"
                        ? "1 ảnh cho mỗi tỉ lệ, đủ để kiểm tra bố cục cả 3 khung."
                        : `Đủ ${RATIO_SPECS.map(r => `${r.count}×${r.ratio}`).join(" + ")} — mỗi ảnh một góc sáng tạo khác nhau, cùng mascot nên vẫn chung nhân vật.`}
                  </p>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{color: t.text}}>
                    <input type="checkbox" checked={abPrecise} onChange={e => setAbPrecise(e.target.checked)} className="h-4 w-4 accent-violet-500"/>
                    💎 Ưu tiên model Sunburst (nét hơn, chậm hơn)
                  </label>
                  {(() => {
                    const unit = AB_COST_PER_IMAGE[abQuality] ?? 0.211;
                    const nImg = abMode === "full" ? APP_CREATIVES.length : abMode === "core" ? 3 : 1;
                    // The mascot is rendered once per run and reused on a retry.
                    const total = (nImg + (abRun.current ? 0 : 1)) * unit;
                    return (
                      <div className="mt-1.5 rounded-lg border px-3 py-2 text-xs" style={{borderColor: t.border, backgroundColor: t.card}}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span style={{color: t.textMuted}}>Đơn giá mỗi ảnh</span>
                          <span className="font-semibold" style={{color: t.text}}>${unit.toFixed(3)} <span style={{color: t.textMuted}}>· {abVnd(unit)}</span></span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                          <span style={{color: t.textMuted}}>Số ảnh gen</span>
                          <span style={{color: t.text}}>{nImg} banner + 1 mascot = {nImg + 1}</span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 mt-1 pt-1 border-t" style={{borderColor: t.border}}>
                          <span className="font-semibold" style={{color: t.text}}>Tổng mỗi lượt gen</span>
                          <span className="font-bold" style={{color: "#A78BFA"}}>${total.toFixed(2)} <span style={{color: t.textMuted, fontWeight: 400}}>· ~{abVnd(total)}</span></span>
                        </div>
                        <div className="mt-1 text-[11px]" style={{color: t.textMuted}}>
                          Thời gian ~{abMode === "full" ? `${Math.ceil((APP_CREATIVES.length / AB_CONCURRENCY) * 35 / 60)}-${Math.ceil((APP_CREATIVES.length / AB_CONCURRENCY) * 70 / 60)} phút` : abMode === "core" ? "1 phút" : "30-60 giây"}
                          {" · tỉ giá tạm tính "}{AB_VND_PER_USD.toLocaleString("vi-VN")}₫/$
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl border" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                  <div>
                    <div className="text-xs font-semibold" style={{color: t.text}}>Chất lượng ảnh AI</div>
                    <div className="text-xs mt-0.5" style={{color: t.textMuted}}>High đẹp nhất nhưng đắt gấp ~4× Medium</div>
                  </div>
                  <div className="flex gap-1 rounded-lg p-0.5 ml-3 flex-shrink-0" style={{backgroundColor: t.border}}>
                    {(["low","medium","high"] as const).map(q => (
                      <button key={q} onClick={() => setAbQuality(q)} className="px-3 py-1 rounded-md text-xs font-semibold capitalize"
                        style={abQuality===q?{backgroundColor:"#7C3AED",color:"#fff"}:{color:t.textMuted}}>{q}</button>
                    ))}
                  </div>
                </div>

                {abError && <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{abError}</p>}

                <button onClick={() => handleAbGenerate(abMode, false)} disabled={!abUrl.trim()}
                  className="w-full py-3 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 transition-all text-white">
                  ✨ {abMode === "one" ? "Gen 1 ảnh duyệt" : `Tạo ${abMode === "core" ? 3 : APP_CREATIVES.length} creative`} →
                </button>
              </div>
            )}

            {abStep === "generating" && (
              <div className="text-center py-20 space-y-6">
                <div className="text-5xl animate-pulse">✨</div>
                <div className="text-lg font-bold" style={{color: t.text}}>Đang tạo banner AI...</div>
                <div className="text-sm font-medium" style={{color:"#A78BFA"}}>{abStatus}</div>
                <div className="w-56 h-1.5 rounded-full overflow-hidden mx-auto" style={{backgroundColor: t.border}}>
                  <div className="h-full bg-gradient-to-r from-violet-500 to-purple-400 animate-pulse" style={{width:"70%"}}/>
                </div>
              </div>
            )}

            {abStep === "preview" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-lg font-bold" style={{color: t.text}}>✅ {abPreviews.length} banner sẵn sàng</div>
                    <div className="text-xs mt-0.5" style={{color: t.textMuted}}>
                      {abBrief?.app_name} · {abCountry}{abBrief?.headline && <span> · &ldquo;{abBrief.headline}&rdquo;</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {/* Retries reuse the cached brief and mascot, so they bill for
                        the images only — worth saying, since the difference is 10x. */}
                    <button onClick={() => handleAbGenerate(abLastMode, true)} disabled={abBusyKey !== null}
                      className="text-xs px-3 py-2 rounded-lg border disabled:opacity-40" style={{borderColor: t.border, color: t.textMuted}}>
                      🔄 Gen lại ({abVnd((abLastMode === "full" ? APP_CREATIVES.length : abLastMode === "core" ? 3 : 1) * (AB_COST_PER_IMAGE[abQuality] ?? 0.211))})
                    </button>
                    {abFailed.length > 0 && (
                      /* Retrying the whole set to replace three failures cost
                         the price of twenty images. This bills for three. */
                      <button onClick={() => handleAbGenerate(abLastMode, true, abFailed)}
                        disabled={abBusyKey !== null}
                        className="text-xs font-semibold px-3 py-2 rounded-lg border disabled:opacity-40"
                        style={{borderColor:"#F59E0B66", color:"#F59E0B", backgroundColor:"#F59E0B14"}}>
                        {abBusyKey === AB_BUSY_BATCH ? "⏳ Đang gen lại..." : `↻ Gen lại ${abFailed.length} ảnh lỗi (${abVnd(abFailed.length * (AB_COST_PER_IMAGE[abQuality] ?? 0.211))})`}
                      </button>
                    )}
                    {abLastMode !== "full" && (
                      <button onClick={() => handleAbGenerate("full", true)} disabled={abBusyKey !== null}
                        className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40"
                        style={{background: "linear-gradient(135deg,#7C3AED,#EC4899)"}}>
                        ✓ Duyệt → gen đủ {APP_CREATIVES.length} ({abVnd(APP_CREATIVES.length * (AB_COST_PER_IMAGE[abQuality] ?? 0.211))})
                      </button>
                    )}
                    <button onClick={abReset} className="text-xs px-3 py-2 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>↩ Về đầu</button>
                    <button onClick={abDownloadZip} className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl">⬇ Tải tất cả (.zip)</button>
                  </div>
                </div>

                {/* Revision box. Retries reuse the cached brief and mascot, so a
                    tweak costs one image — worth stating, since the difference
                    against a fresh run is tenfold. */}
                <div className="rounded-xl border p-3 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold" style={{color: t.text}}>✏️ Muốn sửa gì ở ảnh này?</span>
                    {abRevision.trim() && (
                      <button onClick={() => setAbRevision("")} className="text-[11px] px-2 py-0.5 rounded" style={{backgroundColor: t.border, color: t.textMuted}}>Xoá</button>
                    )}
                  </div>
                  <textarea value={abRevision} onChange={(e) => setAbRevision(e.target.value)} rows={2}
                    placeholder="VD: bỏ chồng sách đi · nền hồng hơn · nhân vật nhìn thẳng vào máy ảnh · điện thoại nghiêng nhẹ sang trái"
                    className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-y"
                    style={{ ...inputStyle, minHeight: 56 }} />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => handleAbGenerate(abLastMode, true)} disabled={!abRevision.trim() || abBusyKey !== null}
                      className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: abRevision.trim() ? "linear-gradient(135deg,#7C3AED,#EC4899)" : "#9CA3AF" }}>
                      ✏️ Sửa và gen lại ({abVnd((abLastMode === "full" ? APP_CREATIVES.length : abLastMode === "core" ? 3 : 1) * (AB_COST_PER_IMAGE[abQuality] ?? 0.211))})
                    </button>
                    <span className="text-[11px]" style={{color: t.textMuted}}>
                      Dùng lại brief + mascot cũ nên chỉ tính tiền phần ảnh. Yêu cầu này giữ nguyên khi bấm &ldquo;Duyệt → gen đủ&rdquo;.
                    </span>
                  </div>
                  <p className="text-[11px]" style={{color: t.textMuted}}>
                    Ô này chỉ đổi <b>hình ảnh</b>. Muốn đổi <b>headline / CTA</b> thì bấm &ldquo;Về đầu&rdquo; rồi sửa trong Creative Direction.
                  </p>
                </div>

                {abError && <p className="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{abError}</p>}


                {abBrief && (
                  <div className="p-3 rounded-xl border text-xs flex flex-wrap gap-3 items-center" style={{...cardStyle, borderColor:"#7C3AED44"}}>
                    {abIcon && <img src={abIcon} alt="" className="w-8 h-8 rounded-lg flex-shrink-0"/>}
                    <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                      <span className="px-2 py-0.5 rounded-full font-medium" style={{backgroundColor:"#7C3AED22",color:"#A78BFA"}}>H: {abBrief.headline}</span>
                      <span className="px-2 py-0.5 rounded-full" style={{backgroundColor:t.tabBg,color:t.textMuted}}>CTA: {abBrief.cta_text}</span>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{backgroundColor:t.tabBg,color:t.textMuted}}>
                        <span className="w-3 h-3 rounded-full inline-block" style={{backgroundColor:abBrief.primary_color}}/>
                        <span className="w-3 h-3 rounded-full inline-block" style={{backgroundColor:abBrief.accent_color}}/>
                        {abBrief.mood}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex gap-1 rounded-xl p-1 w-fit" style={{backgroundColor: t.tabBg}}>
                  {([["top5",`⭐ Mỗi tỉ lệ 1 ảnh (${abPreviews.filter(p=>p.isTop5).length})`],["all",`Tất cả (${abPreviews.length})`]] as const).map(([tab,label])=>(
                    <button key={tab} onClick={() => setAbTab(tab)} className="px-4 py-1.5 rounded-lg text-sm font-medium"
                      style={abTab===tab?{backgroundColor:t.tabActive,color:t.text}:{color:t.textMuted}}>{label}</button>
                  ))}
                </div>

                {/* Pick banners for the MKT System creative library */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button onClick={() => setAbMkSel(prev => Array.from(new Set([...prev, ...abShown.map(p => p.key)])))}
                    className="px-3 py-1.5 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>☑ Chọn tất cả</button>
                  {abMkSel.length > 0 && (
                    <button onClick={() => setAbMkSel([])} className="px-3 py-1.5 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>Bỏ chọn</button>
                  )}
                  <span style={{color: t.textMuted}}>Đã chọn {abMkSel.length} ảnh</span>
                  <button onClick={mkOpenCreativeModal} disabled={!abMkSel.length}
                    className="ml-auto text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{background: "linear-gradient(135deg,#059669,#10B981)"}}>
                    🖼 Upload lên MKT ({abMkSel.length})
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {abShown.map(p => {
                    const scale = Math.min(1, 340/Math.max(p.width, p.height));
                    const picked = abMkSel.includes(p.key);
                    return (
                      <div key={p.key} onClick={() => setSelectedPreview(p)} className="group relative rounded-2xl p-4 cursor-pointer border"
                        style={{...cardStyle, ...(picked && {borderColor: "#7C3AED", boxShadow: "0 0 0 1px #7C3AED"})}}>
                        <button type="button" aria-label="Chọn ảnh" onClick={e => { e.stopPropagation(); mkToggle(setAbMkSel, p.key); }}
                          className="absolute top-2 left-2 z-10 w-5 h-5 rounded border flex items-center justify-center text-[11px] font-bold"
                          style={{backgroundColor: picked ? "#7C3AED" : t.card, borderColor: picked ? "#7C3AED" : t.inputBorder, color: "#fff"}}>
                          {picked ? "✓" : ""}
                        </button>
                        <div className="flex items-center justify-center mb-3" style={{height: Math.round(p.height*scale)+16}}>
                          <img src={p.dataUrl} alt={p.label} style={{width:Math.round(p.width*scale),height:Math.round(p.height*scale)}} className="rounded shadow-lg"/>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold flex items-center gap-1" style={{color: t.text}}>
                              {p.key}
                            </div>
                            <div className="text-xs" style={{color: t.textMuted}}>{p.label}</div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            {/* One bad frame out of twenty is now a 1,400₫ fix
                                rather than a reason to rerun the whole set. */}
                            <button
                              onClick={e => { e.stopPropagation(); handleAbGenerate(abLastMode, true, [p.key]); }}
                              disabled={abBusyKey !== null}
                              title={`Gen lại riêng ảnh này (${abVnd(AB_COST_PER_IMAGE[abQuality] ?? 0.211)})`}
                              className="text-xs px-2 py-1 rounded-lg hover:bg-violet-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                              style={{backgroundColor: t.tabBg, color: t.textSub}}>
                              {abBusyKey === p.key ? "⏳" : "↻"}
                            </button>
                            <button onClick={e => { e.stopPropagation(); const a=document.createElement("a"); a.href=p.dataUrl; a.download=`${p.key}.png`; a.click(); }}
                              title="Tải ảnh này"
                              className="text-xs px-2 py-1 rounded-lg hover:bg-violet-600 hover:text-white"
                              style={{backgroundColor: t.tabBg, color: t.textSub}}>⬇</button>
                          </div>
                        </div>

                        {/* Per-image revision. The box above the grid rewrites the
                            brief for the whole set; this one is scoped to this
                            frame, so fixing one overlap does not restyle the
                            other nineteen. */}
                        <div onClick={e => e.stopPropagation()} className="mt-2 space-y-1.5">
                          <textarea
                            value={abCardRev[p.key] || ""}
                            onChange={e => setAbCardRev(prev => ({ ...prev, [p.key]: e.target.value }))}
                            rows={2}
                            placeholder="Sửa riêng ảnh này: VD chữ đang đè lên mặt, dịch nhân vật sang phải"
                            className="w-full text-[11px] rounded-lg px-2 py-1.5 border focus:outline-none focus:border-violet-500 resize-y"
                            style={{ ...inputStyle, minHeight: 44 }} />
                          <button
                            onClick={() => handleAbGenerate(abLastMode, true, [p.key], abCardRev[p.key] || "")}
                            disabled={!(abCardRev[p.key] || "").trim() || abBusyKey !== null}
                            className="w-full text-[11px] font-semibold px-2 py-1.5 rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: (abCardRev[p.key] || "").trim() ? "linear-gradient(135deg,#7C3AED,#EC4899)" : "#9CA3AF" }}>
                            {abBusyKey === p.key ? "⏳ Đang gen lại..." : `✏️ Sửa riêng ảnh này (${abVnd(AB_COST_PER_IMAGE[abQuality] ?? 0.211)})`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Localisation. Only the four printed strings change; the
                    artwork is the one already paid for, so each extra market is
                    a text call rather than twenty images. */}
                <div className="rounded-2xl border p-4 space-y-3" style={{...cardStyle, borderColor: "#10B98144"}}>
                  <div>
                    <div className="text-sm font-bold" style={{color: t.text}}>🌏 Localize sang thị trường khác</div>
                    <div className="text-[11px] mt-0.5" style={{color: t.textMuted}}>
                      Vẽ lại chữ trên chính bộ ảnh này — <b>không tốn tiền gen ảnh</b>, mỗi thị trường chỉ vài trăm đồng tiền dịch.
                    </div>
                  </div>
                  <div ref={abLocRef} className="relative">
                    <button type="button" onClick={() => { setAbLocOpen(o => !o); setAbLocSearch(""); }}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between focus:outline-none transition-colors"
                      style={{...inputStyle, borderColor: abLocOpen ? "#10B981" : t.inputBorder}}>
                      <span className="truncate" style={!abLocLangs.length ? {color: t.textMuted} : {}}>
                        {abLocLangs.length
                          ? `Đã chọn ${abLocLangs.length} thị trường`
                          : "Chọn thị trường muốn localize..."}
                      </span>
                      <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{abLocOpen ? "▲" : "▼"}</span>
                    </button>
                    {abLocOpen && (
                      <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                        <div className="p-2 border-b" style={{borderColor: t.border}}>
                          <input autoFocus value={abLocSearch} onChange={e => setAbLocSearch(e.target.value)}
                            placeholder="🔍 Gõ để tìm: Deutsch, German, Nhật..."
                            className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-emerald-500"
                            style={inputStyle}/>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {(() => {
                            const q = abLocSearch.trim().toLowerCase();
                            // Match the label, the English name and the market it
                            // maps to, so "Germany", "German" and "Deutsch" all find it.
                            const list = LANGUAGES.filter(l => l.code !== abLang).filter(l =>
                              !q || l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q) ||
                              (LANG_MARKET[l.code] || "").toLowerCase().includes(q));
                            if (!list.length) return <div className="px-4 py-3 text-xs" style={{color: t.textMuted}}>Không tìm thấy ngôn ngữ nào.</div>;
                            return list.map(l => {
                              const on = abLocLangs.includes(l.code);
                              return (
                                <button key={l.code} type="button"
                                  onClick={() => setAbLocLangs(prev => on ? prev.filter(x => x !== l.code) : [...prev, l.code])}
                                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                                  style={{backgroundColor: on ? "#10B98122" : "transparent", color: on ? "#10B981" : t.text}}>
                                  <span className="w-4 flex-shrink-0">{on ? "✓" : ""}</span>
                                  <span className="truncate">{l.label}</span>
                                  {LANG_MARKET[l.code] && (
                                    <span className="ml-auto text-[11px] flex-shrink-0" style={{color: t.textMuted}}>{LANG_MARKET[l.code]}</span>
                                  )}
                                </button>
                              );
                            });
                          })()}
                        </div>
                        <div className="flex items-center justify-between px-3 py-2 border-t" style={{borderColor: t.border}}>
                          <button type="button" onClick={() => setAbLocLangs([])} className="text-[11px]" style={{color: t.textMuted}}>Bỏ chọn tất cả</button>
                          <button type="button" onClick={() => setAbLocOpen(false)} className="text-[11px] font-semibold" style={{color:"#10B981"}}>Xong</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {abLocLangs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {abLocLangs.map(code => (
                        <span key={code} className="text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5"
                          style={{borderColor:"#10B981", backgroundColor:"#10B98122", color:"#10B981"}}>
                          {LANGUAGES.find(l => l.code === code)?.label || code}
                          <button onClick={() => setAbLocLangs(prev => prev.filter(x => x !== code))} title="Bỏ">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={handleAbLocalize} disabled={!abLocLangs.length || abLocBusy !== ""}
                      className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{background: abLocLangs.length ? "linear-gradient(135deg,#059669,#10B981)" : "#9CA3AF"}}>
                      {abLocBusy || `🌏 Localize ${abLocLangs.length || ""} thị trường`}
                    </button>
                    <span className="text-[11px]" style={{color: t.textMuted}}>
                      Chữ trong <b>màn hình điện thoại</b> là một phần của ảnh nên giữ nguyên — muốn đổi cả phần đó thì phải gen lại bộ mới.
                    </span>
                  </div>

                  {abLocSets.map(set => (
                    <div key={set.lang} className="rounded-xl border p-3 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-sm font-semibold" style={{color: t.text}}>
                          {LANGUAGES.find(l => l.code === set.lang)?.label || set.lang}
                          <span className="text-[11px] font-normal ml-2" style={{color: t.textMuted}}>{set.previews.length} banner</span>
                        </div>
                        <button onClick={() => abDownloadB64Zip(set.zip, `google-ads-${abBrief?.app_name || "banners"}-${set.lang}.zip`)}
                          className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">⬇ Tải .zip</button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {set.previews.map(p => (
                          <img key={p.key} src={p.dataUrl} alt={p.label} onClick={() => setSelectedPreview(p)}
                            className="rounded-lg shadow cursor-zoom-in flex-shrink-0"
                            style={{height: 96, width: "auto"}}/>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* MKT SYSTEM — ad templates and creative library over a connect code */}
        {activePage === "mkt" && (
          <div className="space-y-5 max-w-3xl">
            {/* Connection. The guide asks to always show whose code is in use
                and when it dies, so a pasted colleague's code is obvious. */}
            <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
              <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>🔌 Kết nối MKT System</div>
              {mkConn ? (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate" style={{color: t.text}}>✅ {mkConn.email}</div>
                    <div className="text-[11px]" style={{color: t.textMuted}}>
                      Hết hạn {new Date(mkConn.expiresAt).toLocaleString("vi-VN")}
                      {" · còn "}{Math.max(0, Math.round((mkConn.expiresAt - Date.now()) / 3600000))}h
                    </div>
                  </div>
                  <button onClick={mkDisconnect} className="text-xs px-3 py-1.5 rounded-lg border flex-shrink-0" style={{borderColor: t.border, color: t.textMuted}}>Ngắt kết nối</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input value={mkCode} onChange={e => setMkCode(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") mkConnect(); }}
                      placeholder="Dán mã mktmcp_... lấy ở trang Profile của MKT System"
                      className="flex-1 min-w-0 text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                    <button onClick={mkConnect} disabled={!mkCode.trim() || mkBusy === "connect"}
                      className="flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40">
                      {mkBusy === "connect" ? "⏳" : "Kết nối"}
                    </button>
                  </div>
                  <p className="text-[11px]" style={{color: t.textMuted}}>
                    Mã có hiệu lực <b>tối đa 24h tính từ lúc bạn đăng nhập MKT System</b> (không phải lúc copy), không gia hạn và <b>không thu hồi được</b>. Mã được giữ ở server, trình duyệt không đọc lại được.
                  </p>
                </div>
              )}
              {mkError && <p className="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{mkError}</p>}
              {mkNote && <p className="text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 whitespace-pre-wrap" style={{color:"#10B981"}}>{mkNote}</p>}
            </div>

            {mkConn && (
              <>
                {/* Ad template */}
                <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>📝 Ad template Google</div>
                    {sdCopy && (
                      <button onClick={mkFillFromStudio} className="text-xs px-3 py-1.5 rounded-lg border" style={{borderColor:"#7C3AED66", color:"#A78BFA"}}>
                        ↙ Điền từ Ad Copy Studio
                      </button>
                    )}
                  </div>
                  <input value={mkTplName} onChange={e => setMkTplName(e.target.value)}
                    placeholder="Tên template (không trùng template Google khác)"
                    className="w-full text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500" style={inputStyle}/>

                  {mkBlocks.map((b, i) => (
                    <div key={i} className="rounded-xl border p-3 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold" style={{color: t.text}}>Khối {i + 1}</span>
                        {mkBlocks.length > 1 && (
                          <button onClick={() => setMkBlocks(prev => prev.filter((_, j) => j !== i))} className="text-[11px]" style={{color: t.textMuted}}>Xoá khối</button>
                        )}
                      </div>
                      <div>
                        <div className="text-[11px] mb-1" style={{color: t.textMuted}}>Headlines — mỗi dòng một câu, 2–5 câu, ≤30 ký tự</div>
                        <textarea value={b.headlines} rows={4}
                          onChange={e => setMkBlocks(prev => prev.map((x, j) => j === i ? {...x, headlines: e.target.value} : x))}
                          className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-y" style={inputStyle}/>
                      </div>
                      <div>
                        <div className="text-[11px] mb-1" style={{color: t.textMuted}}>Descriptions — mỗi dòng một câu, 1–5 câu, ≤90 ký tự</div>
                        <textarea value={b.descriptions} rows={3}
                          onChange={e => setMkBlocks(prev => prev.map((x, j) => j === i ? {...x, descriptions: e.target.value} : x))}
                          className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-y" style={inputStyle}/>
                      </div>
                    </div>
                  ))}

                  <button onClick={() => setMkBlocks(prev => [...prev, {headlines:"",descriptions:""}])}
                    className="text-xs px-3 py-1.5 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>＋ Thêm khối</button>

                  {/* Checked against the campaign-time rule: the backend would
                      save a template that cannot launch, and say nothing. */}
                  {mkBlockErrors().length > 0 && (mkTplName.trim() || mkBlocks.some(b => b.headlines.trim())) && (
                    <div className="text-[11px] rounded-lg px-3 py-2 space-y-0.5" style={{backgroundColor:"#F59E0B14", color:"#F59E0B"}}>
                      <div className="font-semibold">⚠️ Template này lưu được nhưng KHÔNG tạo campaign được:</div>
                      {mkBlockErrors().map((e, i) => <div key={i}>• {e}</div>)}
                    </div>
                  )}

                  <button onClick={mkCreateTemplate} disabled={!mkTplName.trim() || mkBusy === "template" || mkBlockErrors().length > 0}
                    className="w-full text-sm font-semibold px-4 py-2.5 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{background: "linear-gradient(135deg,#7C3AED,#EC4899)"}}>
                    {mkBusy === "template" ? "⏳ Đang tạo..." : "📝 Tạo ad template"}
                  </button>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px]" style={{color: t.textMuted}}>Template Google đã có ({mkTemplates.length})</span>
                    <button onClick={mkLoadTemplates} className="text-[11px]" style={{color:"#7C3AED"}}>↻ Tải lại</button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {mkTemplates.map(tpl => (
                      <div key={tpl.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{borderColor: t.border}}>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" style={{color: t.text}}>{tpl.name}</div>
                          <div className="text-[10px]" style={{color: t.textMuted}}>{tpl.adContents?.length || 0} khối</div>
                        </div>
                        <button onClick={() => mkTemplateAction(tpl.id, "duplicate")} disabled={mkBusy === tpl.id}
                          className="text-[11px] px-2 py-1 rounded" style={{backgroundColor: t.tabBg, color: t.textMuted}}>Nhân bản</button>
                        <button onClick={() => mkTemplateAction(tpl.id, "delete")} disabled={mkBusy === tpl.id}
                          className="text-[11px] px-2 py-1 rounded" style={{backgroundColor: t.tabBg, color: t.textMuted}}>🗑</button>
                      </div>
                    ))}
                    {!mkTemplates.length && <p className="text-[11px]" style={{color: t.textMuted}}>Chưa có template nào, hoặc chưa bấm Tải lại.</p>}
                  </div>
                </div>

                {/* Creative library */}
                <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>🖼 Upload creative</div>

                  {(abPrevRef.current.length || abPreviews.length) > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{color: t.textMuted}}>Chọn từ bộ AI Banner ({mkPicked.length} đã chọn)</span>
                        <button onClick={() => setMkPicked((abPrevRef.current.length ? abPrevRef.current : abPreviews).map(p => p.key))}
                          className="text-[11px]" style={{color:"#7C3AED"}}>Chọn tất cả</button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {(abPrevRef.current.length ? abPrevRef.current : abPreviews).map(p => {
                          const on = mkPicked.includes(p.key);
                          return (
                            <button key={p.key} onClick={() => setMkPicked(prev => on ? prev.filter(x => x !== p.key) : [...prev, p.key])}
                              className="flex-shrink-0 rounded-lg overflow-hidden border-2"
                              style={{borderColor: on ? "#7C3AED" : "transparent"}}>
                              <img src={p.dataUrl} alt={p.key} style={{height: 72, width: "auto"}}/>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <input ref={mkFileRef} type="file" multiple accept=".jpg,.jpeg,.png,.gif,.mp4,.mov"
                      onChange={e => { mkOnFiles(e.target.files); if (mkFileRef.current) mkFileRef.current.value = ""; }} className="hidden"/>
                    <button onClick={() => mkFileRef.current?.click()}
                      className="text-xs px-3 py-2 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>
                      ＋ Chọn file từ máy (jpg, png, gif, mp4, mov · tối đa 300MB/file)
                    </button>
                    {mkFiles.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {mkFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded" style={{backgroundColor: t.tabBg, color: t.text}}>
                            <span className="flex-1 truncate">{f.name}</span>
                            <button onClick={() => setMkFiles(prev => prev.filter((_, j) => j !== i))} style={{color: t.textMuted}}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{color: t.text}}>
                    <input type="checkbox" checked={mkPublic} onChange={e => setMkPublic(e.target.checked)} className="h-4 w-4 accent-violet-500"/>
                    Public trong thư viện creative
                  </label>

                  <button onClick={mkUploadCreatives} disabled={mkBusy === "creative" || (!mkPicked.length && !mkFiles.length)}
                    className="w-full text-sm font-semibold px-4 py-2.5 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{background: "linear-gradient(135deg,#059669,#10B981)"}}>
                    {mkBusy === "creative" ? "⏳ Đang upload..." : `🖼 Upload ${mkPicked.length + mkFiles.length || ""} creative`}
                  </button>
                  <p className="text-[11px]" style={{color: t.textMuted}}>
                    File đi thẳng lên S3 từ server của web này nên không vướng CORS. Mỗi lần bấm dùng một Idempotency-Key, thử lại sau lỗi mạng sẽ không tạo creative trùng.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* AD COPY STUDIO — keyword research, copy for that keyword, localisation */}
        {activePage === "studio" && (
          <div className="space-y-5">
            <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{color: t.textMuted}}>
                  🔗 URL App Store / Play Store <span className="text-violet-400">*</span>
                </label>
                <div className="flex gap-2">
                  <input value={sdUrl} onChange={e => setSdUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") sdFetchKeywords(); }}
                    placeholder="https://play.google.com/store/apps/details?id=... hoặc https://apps.apple.com/..."
                    className="flex-1 min-w-0 text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                  <button onClick={() => sdFetchKeywords()} disabled={!sdUrl.trim() || sdLoading}
                    className="flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed">
                    {sdLoading ? "⏳ Đang phân tích..." : "🔍 Phân tích"}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Thị trường</label>
                  <select value={sdCountry} onChange={e => { setSdCountry(e.target.value); const dl = COUNTRY_DEFAULT_LANG[e.target.value]; if (dl) setSdLang(dl); }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500" style={inputStyle}>
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1.5" style={{color: t.textMuted}}>Ngôn ngữ ad copy</label>
                  <select value={sdLang} onChange={e => setSdLang(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500" style={inputStyle}>
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>
              </div>
              {sdAppName && <div className="text-xs" style={{color: t.textMuted}}>📱 {sdAppName}</div>}
            </div>

            {sdError && <p className="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{sdError}</p>}

            {sdKeywords.length > 0 && (
              <div className="grid lg:grid-cols-5 gap-5 items-start">
                {/* Keywords, highest volume first */}
                <div className="lg:col-span-3 p-4 border rounded-2xl space-y-3" style={cardStyle}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>
                      🔑 {sdKeywords.length} keyword · volume cao nhất trước
                    </span>
                    <span className="text-[11px]" style={{color: t.textMuted}}>Bấm một keyword để viết copy</span>
                  </div>
                  <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
                    {sdKeywords.map(k => {
                      const on = sdSelected === k.keyword;
                      return (
                        <button key={k.keyword} onClick={() => sdGenerateCopy(k.keyword)}
                          className="w-full text-left px-3 py-2 rounded-xl border transition-colors"
                          style={on
                            ? {borderColor:"#7C3AED", backgroundColor:"#7C3AED18"}
                            : {borderColor: t.border, backgroundColor: "transparent"}}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate flex-1" style={{color: on ? "#A78BFA" : t.text}}>{k.keyword}</span>
                            <span className="text-xs font-semibold flex-shrink-0" style={{color: t.textSub}}>{k.monthly_searches}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                              style={k.competition === "High" ? {backgroundColor:"#EF444422",color:"#EF4444"}
                                : k.competition === "Medium" ? {backgroundColor:"#F59E0B22",color:"#F59E0B"}
                                : {backgroundColor:"#10B98122",color:"#10B981"}}>
                              {k.competition}
                            </span>
                            <span className="text-[10px]" style={{color: t.textMuted}}>${k.cpc_min}–${k.cpc_max}</span>
                            <span className="text-[10px]" style={{color: t.textMuted}}>· {k.intent}</span>
                            <span className="text-[10px] ml-auto" style={{color: t.textMuted}}>relevance {k.relevance}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => sdFetchKeywords(true)} disabled={sdMoreLoading}
                    className="w-full text-xs px-3 py-2 rounded-lg border disabled:opacity-40" style={{borderColor: t.border, color: t.textMuted}}>
                    {sdMoreLoading ? "⏳ Đang tìm thêm..." : "＋ Xem thêm 20 keyword"}
                  </button>
                </div>

                {/* Copy for the chosen keyword, plus localisation */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="p-4 border rounded-2xl space-y-3" style={cardStyle}>
                    {!sdSelected ? (
                      <p className="text-xs py-8 text-center" style={{color: t.textMuted}}>
                        Chọn một keyword bên trái để tạo 5 tiêu đề + 5 mô tả cho đúng keyword đó.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>✍️ Ad copy cho</div>
                            <div className="text-sm font-bold truncate" style={{color:"#A78BFA"}}>{sdSelected}</div>
                          </div>
                          <button onClick={() => sdGenerateCopy(sdSelected)} disabled={sdCopyLoading}
                            className="text-xs px-2.5 py-1.5 rounded-lg border flex-shrink-0 disabled:opacity-40" style={{borderColor: t.border, color: t.textMuted}}>
                            {sdCopyLoading ? "⏳" : "↻ Viết lại"}
                          </button>
                        </div>

                        {sdCopyLoading && <p className="text-xs" style={{color: t.textMuted}}>⏳ Đang viết 5 tiêu đề và 5 mô tả...</p>}

                        {sdCopy && (
                          <div className="space-y-3">
                            {([["Tiêu đề", sdCopy.headlines, 30], ["Mô tả", sdCopy.descriptions, 90]] as [string,string[],number][]).map(([label, items, limit]) => (
                              <div key={label} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-semibold" style={{color: t.textSub}}>{label} (tối đa {limit} ký tự)</span>
                                  <button onClick={() => sdCopyText(items.join("\n"), label)} className="text-[11px]" style={{color:"#7C3AED"}}>
                                    {sdCopied === label ? "✓ Đã chép" : "Chép hết"}
                                  </button>
                                </div>
                                {items.map((item, i) => {
                                  const sel = label === "Tiêu đề" ? sdSelH : label === "Mô tả" ? sdSelD : null;
                                  const setSel = label === "Tiêu đề" ? setSdSelH : setSdSelD;
                                  return (
                                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs" style={{backgroundColor: t.tabBg}}>
                                    {/* Headlines and descriptions can go into an MKT ad template; CTAs cannot. */}
                                    {sel && (
                                      <button type="button" aria-label="Chọn" onClick={() => mkToggle(setSel, item)}
                                        className="w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                        style={{backgroundColor: sel.includes(item) ? "#7C3AED" : "transparent", borderColor: sel.includes(item) ? "#7C3AED" : t.inputBorder, color: "#fff"}}>
                                        {sel.includes(item) ? "✓" : ""}
                                      </button>
                                    )}
                                    <span className="flex-1 min-w-0 break-words" style={{color: t.text}}>{item}</span>
                                    {/* Over the limit Google truncates mid-word, so flag it here rather than in the interface. */}
                                    <span className="text-[10px] flex-shrink-0" style={item.length > limit ? {color:"#EF4444"} : {color: t.textMuted}}>{item.length}</span>
                                    <button onClick={() => sdCopyText(item, `${label}-${i}`)} className="text-[10px] flex-shrink-0" style={{color: t.textMuted}}>
                                      {sdCopied === `${label}-${i}` ? "✓" : "⧉"}
                                    </button>
                                  </div>
                                  );
                                })}
                              </div>
                            ))}
                            <div className="flex items-center gap-2 pt-1">
                              <button onClick={() => { setSdSelH([...sdCopy.headlines]); setSdSelD([...sdCopy.descriptions]); }}
                                className="text-[11px] px-2.5 py-1.5 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>☑ Chọn hết tiêu đề + mô tả</button>
                              <button onClick={sdAddToBasket} disabled={!sdSelH.length && !sdSelD.length}
                                className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{background: "linear-gradient(135deg,#7C3AED,#EC4899)"}}>
                                {sdBasket.some(b => b.keyword === sdSelected)
                                  ? `↻ Cập nhật Khối ${sdBasket.findIndex(b => b.keyword === sdSelected) + 1} (${sdSelH.length} tiêu đề · ${sdSelD.length} mô tả)`
                                  : `➕ Thêm vào template — Khối ${sdBasket.length + 1} (${sdSelH.length} tiêu đề · ${sdSelD.length} mô tả)`}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Template basket: survives switching keyword, one block per keyword */}
                  {sdBasket.length > 0 && (
                    <div className="p-4 border rounded-2xl space-y-2" style={{...cardStyle, borderColor:"#7C3AED66"}}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold" style={{color: t.text}}>📝 Ad template MKT — {sdBasket.length} khối</div>
                        <button onClick={() => setSdBasket([])} className="text-[11px]" style={{color: t.textMuted}}>Xoá hết</button>
                      </div>
                      <div className="text-[11px]" style={{color: t.textMuted}}>Chọn keyword khác, tick content rồi bấm ➕ để thêm khối tiếp theo.</div>
                      {sdBasket.map((b, i) => (
                        <div key={b.keyword} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs" style={{backgroundColor: t.tabBg}}>
                          <span className="font-semibold flex-shrink-0" style={{color: "#A78BFA"}}>Khối {i + 1}</span>
                          <span className="flex-1 min-w-0 truncate" style={{color: t.text}}>{b.keyword}</span>
                          <span className="flex-shrink-0" style={{color: t.textMuted}}>{b.headlines.length} tiêu đề · {b.descriptions.length} mô tả</span>
                          <button onClick={() => setSdBasket(prev => prev.filter((_, j) => j !== i))} title="Bỏ khối này"
                            className="flex-shrink-0 px-1" style={{color: t.textMuted}}>✕</button>
                        </div>
                      ))}
                      <button onClick={mkOpenTemplateModal}
                        className="w-full text-sm font-semibold px-4 py-2 rounded-xl text-white"
                        style={{background: "linear-gradient(135deg,#7C3AED,#EC4899)"}}>
                        📝 Tạo ad template MKT ({sdBasket.length} khối)
                      </button>
                    </div>
                  )}

                  {(sdCopy || sdBasket.length > 0) && (
                    <div className="p-4 border rounded-2xl space-y-3" style={{...cardStyle, borderColor:"#10B98144"}}>
                      <div>
                        <div className="text-sm font-bold" style={{color: t.text}}>🌏 Localize sang thị trường khác</div>
                        <div className="text-[11px] mt-0.5" style={{color: t.textMuted}}>
                          {sdBasket.length
                            ? `Dịch ${sdBasket.length} khối đã chọn sang nhiều thị trường, giữ nguyên từng khối — mỗi thị trường tạo được 1 template.`
                            : "Tick tiêu đề / mô tả rồi bấm ➕ Thêm vào template trước — localize dịch theo các khối đã chọn."}
                        </div>
                      </div>
                      <div ref={sdLocRef} className="relative">
                        <button type="button" onClick={() => { setSdLocOpen(o => !o); setSdLocSearch(""); }}
                          className="w-full rounded-xl px-3 py-2.5 text-sm border text-left flex items-center justify-between"
                          style={{...inputStyle, borderColor: sdLocOpen ? "#10B981" : t.inputBorder}}>
                          <span className="truncate" style={!sdLocMarkets.length ? {color: t.textMuted} : {}}>
                            {sdLocMarkets.length ? `Đã chọn ${sdLocMarkets.length} thị trường` : "Chọn thị trường..."}
                          </span>
                          <span className="text-xs ml-2 flex-shrink-0" style={{color: t.textMuted}}>{sdLocOpen ? "▲" : "▼"}</span>
                        </button>
                        {sdLocOpen && (
                          <div className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{backgroundColor: t.card, borderColor: t.border}}>
                            <div className="p-2 border-b" style={{borderColor: t.border}}>
                              <input autoFocus value={sdLocSearch} onChange={e => setSdLocSearch(e.target.value)}
                                placeholder="🔍 Gõ để tìm thị trường..."
                                className="w-full text-sm px-3 py-1.5 rounded-lg border focus:outline-none focus:border-emerald-500" style={inputStyle}/>
                            </div>
                            <div className="max-h-56 overflow-y-auto">
                              {LOCALIZE_MARKETS
                                .filter(m => !sdLocSearch.trim() || m.name.toLowerCase().includes(sdLocSearch.trim().toLowerCase()) || m.code.toLowerCase().includes(sdLocSearch.trim().toLowerCase()))
                                .map(m => {
                                  const on = sdLocMarkets.includes(m.code);
                                  return (
                                    <button key={m.code} type="button"
                                      onClick={() => setSdLocMarkets(prev => on ? prev.filter(x => x !== m.code) : [...prev, m.code])}
                                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                                      style={{backgroundColor: on ? "#10B98122" : "transparent", color: on ? "#10B981" : t.text}}>
                                      <span className="w-4 flex-shrink-0">{on ? "✓" : ""}</span>
                                      <span>{m.flag} {m.name}</span>
                                    </button>
                                  );
                                })}
                            </div>
                            <div className="flex items-center justify-between px-3 py-2 border-t" style={{borderColor: t.border}}>
                              <button type="button" onClick={() => setSdLocMarkets([])} className="text-[11px]" style={{color: t.textMuted}}>Bỏ chọn tất cả</button>
                              <button type="button" onClick={() => setSdLocOpen(false)} className="text-[11px] font-semibold" style={{color:"#10B981"}}>Xong</button>
                            </div>
                          </div>
                        )}
                      </div>
                      <button onClick={sdLocalizeBasket} disabled={!sdBasket.length || !sdLocMarkets.length || sdLocLoading}
                        className="w-full text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{background: sdBasket.length && sdLocMarkets.length ? "linear-gradient(135deg,#059669,#10B981)" : "#9CA3AF"}}>
                        {sdLocLoading ? "⏳ Đang dịch..." : !sdBasket.length ? "🌏 Thêm ít nhất 1 khối để localize" : `🌏 Localize ${sdBasket.length} khối · ${sdLocMarkets.length || ""} thị trường`}
                      </button>

                      {/* Localized blocks, one template per market */}
                      {sdLocBlocks && sdLocBlocks.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px]" style={{color: t.textMuted}}>
                              {Object.keys(sdLocTplDone).length}/{sdLocBlocks.length} thị trường đã có template
                            </span>
                            <button onClick={sdCreateAllLocTemplates} disabled={!!mkBusy || sdLocBlocks.every(m => sdLocTplDone[m.code])}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{background: "linear-gradient(135deg,#7C3AED,#EC4899)"}}>
                              {mkBusy === "loc-all" ? "⏳ Đang tạo..." : `📝 Tạo tất cả (${sdLocBlocks.filter(m => !sdLocTplDone[m.code]).length} template)`}
                            </button>
                          </div>
                          {!mkModal && mkError && <p className="text-amber-400 text-[11px] bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{mkError}</p>}
                          {!mkModal && mkNote && <p className="text-[11px] bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 whitespace-pre-wrap" style={{color:"#10B981"}}>{mkNote}</p>}
                          {sdLocBlocks.map(m => {
                            const errs = mkValidate(mkSplitBlocks(m.blocks));
                            return (
                              <div key={m.code} className="rounded-xl border p-3 space-y-2" style={{borderColor: sdLocTplDone[m.code] ? "#10B98166" : t.border, backgroundColor: t.tabBg}}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold" style={{color: t.text}}>{m.flag} {m.name} <span className="text-[11px] font-normal" style={{color: t.textMuted}}>· {m.language}</span></span>
                                  {sdLocTplDone[m.code] ? (
                                    <span className="text-[11px] font-semibold" style={{color:"#10B981"}}>✓ Đã tạo template</span>
                                  ) : (
                                    <button onClick={() => mkOpenTemplateFor(m.blocks, sdLocTplName(m), m.code)} disabled={!!mkBusy}
                                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white disabled:opacity-40"
                                      style={{background: "linear-gradient(135deg,#7C3AED,#EC4899)"}}>📝 Tạo template {m.code}</button>
                                  )}
                                </div>
                                {m.blocks.map((b, i) => (
                                  <div key={i} className="rounded-lg px-2 py-1.5" style={{backgroundColor: t.card}}>
                                    <div className="text-[10px] font-semibold mb-0.5" style={{color: "#A78BFA"}}>Khối {i + 1} · {m.keywords[i]}</div>
                                    {b.headlines.map((h, k) => (
                                      <div key={`h${k}`} className="text-xs px-1 break-words flex gap-2" style={{color: t.text}}>
                                        <span className="flex-1">• {h}</span><span className="text-[10px]" style={{color: h.length > 30 ? "#EF4444" : t.textMuted}}>{h.length}</span>
                                      </div>
                                    ))}
                                    {b.descriptions.map((d, k) => (
                                      <div key={`d${k}`} className="text-xs px-1 break-words flex gap-2" style={{color: t.textSub}}>
                                        <span className="flex-1">– {d}</span><span className="text-[10px]" style={{color: d.length > 90 ? "#EF4444" : t.textMuted}}>{d.length}</span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                                {errs.length > 0 && <div className="text-[10px]" style={{color:"#F59E0B"}}>⚠️ {errs.join(" · ")}</div>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* COMPETITOR PAGE */}
        {activePage === "competitor" && (
          <div className="max-w-xl space-y-4">
            <div className="text-xs" style={{color: t.textMuted}}>Nhập link App Store hoặc Play Store của app đối thủ</div>
            <input value={compQuery} onChange={e => {
              const val = e.target.value; setCompQuery(val); setCompAppName(""); setCompAppIcon("");
              if (val.trim().startsWith("http")) lookupAppNamePreview(val.trim());
            }}
              placeholder="https://apps.apple.com/... hoặc https://play.google.com/..."
              className="w-full text-sm rounded-xl px-4 py-3 border focus:outline-none focus:border-violet-500"
              style={inputStyle}/>
            {compQuery.trim().startsWith("http") && (
              <div className="flex items-center gap-2 px-1">
                {compNameLoading ? <span className="text-xs" style={{color: t.textMuted}}>⏳ Đang nhận diện app...</span>
                  : compAppName ? (
                    <>
                      {compAppIcon && <img src={compAppIcon} alt="" className="w-8 h-8 rounded-xl flex-shrink-0"/>}
                      <span className="text-sm font-semibold" style={{color: t.text}}>{compAppName}</span>
                    </>
                  ) : null}
              </div>
            )}
            {compQuery.trim() && (
              <button onClick={handleCompetitorSearch} disabled={compLoading || compNameLoading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-3 px-4 rounded-xl transition-all font-semibold flex items-center justify-center gap-2">
                {compLoading ? <><span>⏳</span> Đang mở...</> : <>🔎 Xem quảng cáo trên Google</>}
              </button>
            )}
            <div className="text-xs font-semibold mt-6" style={{color: t.textMuted}}>Ví dụ nhanh</div>
            {["https://apps.apple.com/us/app/canva/id897446215","https://play.google.com/store/apps/details?id=com.canva.editor"].map(ex => (
              <button key={ex} onClick={() => setCompQuery(ex)}
                className="w-full text-left text-sm px-4 py-3 rounded-xl border transition-colors"
                style={cardStyle}>
                {ex.includes("apple") ? "🍎 App Store — Canva" : "🤖 Play Store — Canva"}
              </button>
            ))}
          </div>
        )}

        {/* LAUNCH CAMPAIGN PAGE */}
        {activePage === "launch" && (
          <div className="space-y-5">
            {/* Connect Google Ads */}
            <div className="p-5 border rounded-2xl" style={cardStyle}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-sm" style={{color: t.text}}>Kết nối Google Ads</div>
                  <div className="text-xs mt-0.5" style={{color: t.textMuted}}>Authorize để tạo campaign trực tiếp</div>
                </div>
                {adsConnected === null ? (
                  <div className="text-xs" style={{color: t.textMuted}}>Đang kiểm tra...</div>
                ) : adsConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-500 font-medium">✓ Đã kết nối</span>
                    <button onClick={async()=>{ await fetch("/api/google-ads/auth?action=disconnect"); setAdsConnected(false); setAdsAccounts([]); }}
                      className="text-xs px-2 py-1 rounded-lg border" style={{color:t.textMuted,borderColor:t.border}}>Ngắt kết nối</button>
                  </div>
                ) : (
                  <a href="/api/google-ads/auth?action=connect"
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors">
                    🔗 Connect Google Ads
                  </a>
                )}
              </div>
            </div>

            {adsConnected && (
              <>
                {/* Select Account */}
                <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={labelStyle}>Chọn tài khoản Google Ads</label>
                  {adsNeedsBasicAccess ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">⏳</span>
                        <div>
                          <div className="text-sm font-semibold text-amber-400 mb-1">Đang chờ phê duyệt Basic Access</div>
                          <div className="text-xs text-amber-300/80 leading-relaxed">
                            Developer Token hiện ở chế độ <b>Explorer (Test)</b> — không thể truy cập tài khoản Google Ads thật.<br/>
                            Bạn đã nộp đơn xin <b>Basic Access</b>. Google thường phê duyệt trong <b>3–5 ngày làm việc</b>.
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-amber-300/70 bg-amber-500/10 rounded-lg px-3 py-2 space-y-1">
                        <div>✅ Đơn đã được gửi đến Google Ads API Center</div>
                        <div>📧 Bạn sẽ nhận email khi được phê duyệt</div>
                        <div>🔄 Sau khi được duyệt, nhấn <b>Thử lại</b> để tải tài khoản</div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={loadAdsAccounts} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-black font-semibold">🔄 Thử lại</button>
                        <a href="https://ads.google.com/nav/selectaccount?dst=/aw/apicenter" target="_blank" rel="noreferrer"
                          className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/50 text-amber-400">Kiểm tra trạng thái →</a>
                      </div>
                    </div>
                  ) : adsAccountsError ? (
                    <div className="space-y-2">
                      <div className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 break-all">{adsAccountsError}</div>
                      <button onClick={loadAdsAccounts} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white">Thử lại</button>
                    </div>
                  ) : adsAccountsLoading ? (
                    <div className="text-xs" style={{color:t.textMuted}}>⏳ Đang tải tài khoản...</div>
                  ) : adsAccounts.length === 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="text-xs" style={{color:t.textMuted}}>Không có tài khoản nào</div>
                      <button onClick={loadAdsAccounts} className="text-xs px-2 py-1 rounded-lg border" style={{borderColor:t.border,color:t.textMuted}}>Tải lại</button>
                    </div>
                  ) : (
                    <select value={adsSelectedAccount} onChange={e=>{ setAdsSelectedAccount(e.target.value); if(e.target.value) loadAdsCampaigns(e.target.value); }}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none" style={inputStyle}>
                      <option value="">-- Chọn account --</option>
                      {adsAccounts.map(a=>(
                        <option key={a.id} value={a.id}>{a.name} ({a.id}) — {a.currency}</option>
                      ))}
                    </select>
                  )}
                </div>

                {adsSelectedAccount && (
                  <>
                    {/* Campaign Settings */}
                    <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
                      <div className="font-semibold text-sm" style={{color:t.text}}>Cấu hình Campaign</div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>Tên campaign</label>
                          <input value={adsCampaignName} onChange={e=>setAdsCampaignName(e.target.value)}
                            placeholder="VD: Pix Editor - VN Q1" className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                        </div>
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>Budget/ngày (VNĐ)</label>
                          <input value={adsBudget} onChange={e=>setAdsBudget(e.target.value)} type="number"
                            placeholder="200000" className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>App ID</label>
                          <input value={adsAppId} onChange={e=>setAdsAppId(e.target.value)}
                            placeholder="com.apero.pixeditor" className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                        </div>
                        <div>
                          <label className="text-xs font-semibold mb-1.5 block" style={labelStyle}>Store</label>
                          <select value={adsAppStore} onChange={e=>setAdsAppStore(e.target.value as "GOOGLE_APP_STORE"|"APPLE_APP_STORE")}
                            className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}>
                            <option value="GOOGLE_APP_STORE">🤖 Google Play</option>
                            <option value="APPLE_APP_STORE">🍎 App Store</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Headlines & Descriptions */}
                    <div className="p-5 border rounded-2xl space-y-4" style={cardStyle}>
                      <div className="font-semibold text-sm" style={{color:t.text}}>Ad Copy</div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold" style={labelStyle}>Headlines (tối đa 5, mỗi cái ≤30 ký tự)</label>
                        {adsHeadlines.map((h,i)=>(
                          <div key={i} className="flex gap-2 items-center">
                            <input value={h} onChange={e=>{ const arr=[...adsHeadlines]; arr[i]=e.target.value.slice(0,30); setAdsHeadlines(arr); }}
                              placeholder={`Headline ${i+1}`} className="flex-1 rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                            <span className="text-xs w-8 text-right" style={{color:t.textMuted}}>{h.length}/30</span>
                          </div>
                        ))}
                        {adsHeadlines.length < 5 && (
                          <button onClick={()=>setAdsHeadlines([...adsHeadlines,""])} className="text-xs" style={{color:"#7C3AED"}}>+ Thêm headline</button>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold" style={labelStyle}>Descriptions (tối đa 5, mỗi cái ≤90 ký tự)</label>
                        {adsDescriptions.map((d,i)=>(
                          <div key={i} className="flex gap-2 items-center">
                            <input value={d} onChange={e=>{ const arr=[...adsDescriptions]; arr[i]=e.target.value.slice(0,90); setAdsDescriptions(arr); }}
                              placeholder={`Description ${i+1}`} className="flex-1 rounded-xl px-3 py-2 text-sm border focus:outline-none" style={inputStyle}/>
                            <span className="text-xs w-8 text-right" style={{color:t.textMuted}}>{d.length}/90</span>
                          </div>
                        ))}
                        {adsDescriptions.length < 5 && (
                          <button onClick={()=>setAdsDescriptions([...adsDescriptions,""])} className="text-xs" style={{color:"#7C3AED"}}>+ Thêm description</button>
                        )}
                      </div>
                    </div>

                    {/* Select Banners from history */}
                    {adsBannerPool.length > 0 && (
                      <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-sm" style={{color:t.text}}>Chọn banner để upload ({adsSelectedBanners.length} đã chọn)</div>
                          <button onClick={()=>setAdsSelectedBanners(adsBannerPool.filter(p=>p.isTop5).map(p=>p.dataUrl))} className="text-xs" style={{color:"#7C3AED"}}>Chọn Top 5</button>
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {adsBannerPool.slice(0,20).map((p,i)=>{
                            const sel = adsSelectedBanners.includes(p.dataUrl);
                            return (
                              <div key={i} onClick={()=>setAdsSelectedBanners(sel ? adsSelectedBanners.filter(x=>x!==p.dataUrl) : [...adsSelectedBanners,p.dataUrl])}
                                className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${sel?"border-violet-500":"border-transparent"}`}>
                                <img src={p.dataUrl} alt={p.key} className="w-full h-16 object-contain" style={{background:"#111"}}/>
                                {sel && <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center text-white text-[9px]">✓</div>}
                                <div className="text-[9px] text-center truncate px-1 py-0.5" style={{color:t.textMuted}}>{p.key}</div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs" style={{color:t.textMuted}}>💡 Gen banner ở trang Gen Banner trước rồi quay lại đây chọn</p>
                      </div>
                    )}

                    {/* Launch Button */}
                    {adsResult && (
                      <div className={`px-4 py-3 rounded-xl text-sm ${adsResult.success?"bg-green-500/10 text-green-500":"bg-red-500/10 text-red-400"}`}>
                        {adsResult.success ? `✅ ${adsResult.message}` : `❌ ${adsResult.error}`}
                      </div>
                    )}

                    <button onClick={handleAdsLaunch} disabled={adsLaunching || !adsCampaignName || !adsAppId}
                      className="w-full py-3.5 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-all">
                      {adsLaunching ? "⏳ Đang tạo campaign..." : "🚀 Tạo Campaign Google Ads"}
                    </button>

                    {/* Existing Campaigns */}
                    {adsCampaigns.length > 0 && (
                      <div className="p-5 border rounded-2xl space-y-3" style={cardStyle}>
                        <div className="font-semibold text-sm" style={{color:t.text}}>App Campaigns hiện có</div>
                        <div className="space-y-2">
                          {adsCampaigns.map(c=>(
                            <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-xl border" style={{borderColor:t.border}}>
                              <div>
                                <div className="text-sm font-medium" style={{color:t.text}}>{c.name}</div>
                                <div className="text-xs" style={{color:t.textMuted}}>Budget: {c.budgetPerDay.toLocaleString()}đ/ngày</div>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.status==="ENABLED"?"bg-green-500/15 text-green-500":c.status==="PAUSED"?"bg-yellow-500/15 text-yellow-500":"bg-gray-500/15 text-gray-400"}`}>
                                {c.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {!adsConnected && adsConnected !== null && (
              <div className="p-6 border rounded-2xl text-center space-y-3" style={cardStyle}>
                <div className="text-3xl">🔗</div>
                <div className="font-semibold" style={{color:t.text}}>Chưa kết nối Google Ads</div>
                <div className="text-sm" style={{color:t.textMuted}}>Bấm &ldquo;Connect Google Ads&rdquo; ở trên để authorize</div>
              </div>
            )}
          </div>
        )}

        {/* HISTORY PAGE */}
        {activePage === "history" && (
          <div className="space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-20" style={{color: t.textMuted}}>
                <div className="text-4xl mb-3">🕐</div>
                <div className="text-sm">Chưa có lịch sử. Gen banner đầu tiên để lưu ở đây.</div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {history.map(h => (
                  <div key={h.id} className="rounded-2xl border overflow-hidden" style={cardStyle}>
                    {h.thumbnail && <img src={h.thumbnail} alt="" className="w-full object-cover" style={{height:96}}/>}
                    <div className="p-4">
                      <div className="font-semibold text-sm truncate" style={{color: t.text}}>{h.appName || "Untitled"}</div>
                      <div className="text-xs mt-0.5 mb-3" style={{color: t.textMuted}}>{h.date} · {h.count} ảnh</div>
                      <button onClick={() => deleteHistory(h.id)} className="text-xs px-2.5 py-1.5 rounded-lg border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>🗑 Xóa</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* YOUTUBE UPLOAD PAGE */}
        {activePage === "youtube" && (
          <div className="space-y-6 max-w-3xl">
            {!ytAuthenticated ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-6">
                <div className="text-6xl">▶️</div>
                <div className="text-center">
                  <div className="text-xl font-bold mb-2" style={{color: t.text}}>Upload video lên YouTube</div>
                  <div className="text-sm" style={{color: t.textMuted}}>Đăng nhập Google để bắt đầu upload hàng loạt</div>
                </div>
                <a href="/api/auth/google"
                  className="flex items-center gap-3 px-6 py-3 rounded-xl font-semibold text-sm transition-all border"
                  style={{backgroundColor: t.card, borderColor: t.border, color: t.text, boxShadow: t.cardShadow}}>
                  <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  Đăng nhập với Google
                </a>
                <p className="text-xs text-center" style={{color: t.textMuted}}>Chỉ cấp quyền upload video lên YouTube của bạn</p>
              </div>
            ) : (
              <>
                {/* Top bar */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>
                    <span className="text-sm" style={{color: t.textMuted}}>Đã kết nối Google</span>
                  </div>
                  <button onClick={ytLogout} className="text-xs px-3 py-1.5 rounded-lg border transition-colors" style={{borderColor: t.border, color: t.textMuted}}>
                    Đăng xuất
                  </button>
                </div>

                {/* Drop zone */}
                <div onClick={() => ytFileRef.current?.click()}
                  className="border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all"
                  style={{borderColor: t.border}}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#7C3AED")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = t.border)}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#7C3AED"; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = t.border; if (e.dataTransfer.files.length) addYtFiles(e.dataTransfer.files); }}>
                  <div className="text-3xl mb-2">🎬</div>
                  <div className="text-sm font-medium mb-1" style={{color: t.text}}>Kéo thả video vào đây hoặc click để chọn</div>
                  <div className="text-xs" style={{color: t.textMuted}}>MP4, MOV, AVI, MKV — nhiều file cùng lúc</div>
                  <input ref={ytFileRef} type="file" accept="video/*" multiple className="hidden" onChange={e => e.target.files && addYtFiles(e.target.files)}/>
                </div>

                {/* Video list */}
                {ytVideos.length > 0 && (
                  <div className="space-y-3">
                    {ytVideos.map((v, i) => (
                      <div key={i} className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                        <div className="flex items-center gap-3">
                          <div className="text-2xl flex-shrink-0">🎬</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate" style={{color: t.text}}>{v.title || v.file.name}</div>
                            <div className="text-xs" style={{color: t.textMuted}}>{(v.file.size/1024/1024).toFixed(1)} MB</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {v.status === "done" && <span className="text-xs font-bold text-green-400">✓ Done</span>}
                            {v.status === "done" && v.videoId && (
                              ytCopiedIndex === i ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs px-2 py-1 rounded-lg border font-medium"
                                    style={{borderColor:"#6D28D9",color:"#A78BFA",backgroundColor:"#6D28D922",
                                      animation:"popIn 0.2s ease-out"}}>
                                    ✓ Đã copy!
                                  </span>
                                  <button onClick={() => setYtCopiedIndex(null)}
                                    className="text-xs px-1.5 py-1 rounded-lg border transition-all hover:bg-slate-100"
                                    style={{borderColor:t.border,color:t.textMuted}}
                                    title="Reset">↺</button>
                                </div>
                              ) : (
                                <button onClick={() => {
                                  const url = `https://youtu.be/${v.videoId}`;
                                  try { navigator.clipboard.writeText(url); } catch { /* fallback */ }
                                  setYtCopiedIndex(i);
                                }}
                                  className="text-xs px-2 py-1 rounded-lg border transition-all duration-150 active:scale-95"
                                  style={{borderColor:"#10B981",color:"#10B981",backgroundColor:"#10B98111"}}
                                  title={`https://youtu.be/${v.videoId}`}>
                                  🔗 Copy link
                                </button>
                              )
                            )}
                            {v.status === "error" && <span className="text-xs font-bold text-red-400">✗ Lỗi</span>}
                            {v.status === "uploading" && <span className="text-xs" style={{color: t.textMuted}}>{v.progress}%</span>}
                            {v.status !== "uploading" && (
                              <button onClick={() => setYtVideos(prev => prev.filter((_, j) => j !== i))}
                                className="text-xs px-2 py-1 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>✕</button>
                            )}
                          </div>
                        </div>

                        {/* Progress bar */}
                        {v.status === "uploading" && (
                          <div className="h-1.5 rounded-full overflow-hidden" style={{backgroundColor: t.progress}}>
                            <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-300" style={{width: `${v.progress}%`}}/>
                          </div>
                        )}
                        {v.status === "error" && <div className="text-xs text-red-400">{v.errorMsg}</div>}

                        {/* Metadata */}
                        {(v.status === "idle" || v.status === "error") && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="col-span-2">
                              <input value={v.title} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,title:e.target.value}:x))}
                                placeholder="Tiêu đề video *"
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500"
                                style={inputStyle}/>
                            </div>
                            <div className="col-span-2">
                              <textarea value={v.description} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,description:e.target.value}:x))}
                                placeholder="Mô tả (tuỳ chọn)" rows={2}
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-none"
                                style={inputStyle}/>
                            </div>
                            <div>
                              <input value={v.tags} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,tags:e.target.value}:x))}
                                placeholder="Tags (cách nhau bởi dấu phẩy)"
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500"
                                style={inputStyle}/>
                            </div>
                            <div>
                              <select value={v.privacy} onChange={e => setYtVideos(prev => prev.map((x,j)=>j===i?{...x,privacy:e.target.value as "public"|"unlisted"|"private"}:x))}
                                className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500"
                                style={inputStyle}>
                                <option value="unlisted">🔗 Unlisted (có link xem được)</option>
                                <option value="private">🔒 Private (chỉ mình tôi)</option>
                                <option value="public">🌍 Public (công khai)</option>
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Upload button */}
                    <div className="flex gap-3">
                      <button onClick={handleYtUploadAll}
                        disabled={ytUploading || ytVideos.every(v => v.status === "done")}
                        className="flex-1 py-3 rounded-xl font-semibold text-sm bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white flex items-center justify-center gap-2">
                        {ytUploading
                          ? <><span className="animate-spin">⏳</span> Đang upload {ytVideos.filter(v=>v.status==="uploading").length > 0 ? `(${ytVideos.filter(v=>v.status==="uploading")[0]?.progress}%)` : ""}...</>
                          : <>▶️ Upload {ytVideos.filter(v=>v.status==="idle"||v.status==="error").length} video lên YouTube</>}
                      </button>
                      <button onClick={() => setYtVideos([])} disabled={ytUploading}
                        className="px-4 py-3 rounded-xl border text-sm transition-colors disabled:opacity-40"
                        style={{borderColor: t.border, color: t.textMuted}}>
                        Xóa tất cả
                      </button>
                    </div>

                    {/* Summary */}
                    {ytVideos.some(v => v.status === "done") && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        ✓ {ytVideos.filter(v=>v.status==="done").length}/{ytVideos.length} video đã upload thành công
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </main>

      {/* MKT System modals, opened from AI Banner and Ad Copy Studio */}
      {mkModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={() => { if (!mkBusy) setMkModal(null); }}>
          <div className="rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-4 border" style={{...cardStyle, boxShadow:"0 25px 80px rgba(0,0,0,0.4)"}} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-bold" style={{color: t.text}}>{mkModal === "creative" ? "🖼 Upload creative lên MKT System" : "📝 Tạo ad template Google"}</div>
                <div className="text-[11px] mt-0.5" style={{color: t.textMuted}}>
                  {mkModal === "creative"
                    ? `${abMkSel.length} ảnh · jpg/png/gif/mp4/mov, tối đa 300MB/file`
                    : "Mỗi khối: 2–5 headline khác nhau (≤30 ký tự), 1–5 description (≤90 ký tự). Mọi khối đều được dùng khi tạo campaign."}
                </div>
              </div>
              <button onClick={() => setMkModal(null)} disabled={!!mkBusy} className="px-2 py-1 rounded-lg" style={{color: t.textMuted}}>✕</button>
            </div>

            {!mkConn ? (
              <div className="space-y-2">
                <div className="text-sm" style={{color: t.text}}>Chưa kết nối MKT System. Dán mã kết nối (trang Profile của MKT System → <b>Kết nối Claude</b>):</div>
                <div className="flex gap-2">
                  <input value={mkCode} onChange={e => setMkCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") mkConnect(); }}
                    placeholder="mktmcp_..." className="flex-1 min-w-0 text-sm rounded-xl px-3 py-2.5 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                  <button onClick={mkConnect} disabled={!mkCode.trim() || mkBusy === "connect"}
                    className="flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40">
                    {mkBusy === "connect" ? "⏳" : "Kết nối"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[11px] px-3 py-2 rounded-lg" style={{backgroundColor: t.tabBg, color: t.textMuted}}>
                Tài khoản: <b style={{color: t.text}}>{mkConn.email}</b> · hết hạn {new Date(mkConn.expiresAt).toLocaleString("vi-VN")}
              </div>
            )}

            {mkConn && mkModal === "creative" && (
              <>
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>Tên hiển thị trong thư viện *</div>
                  {(abPrevRef.current.length ? abPrevRef.current : abPreviews).filter(p => abMkSel.includes(p.key)).map(p => (
                    <div key={p.key} className="flex items-center gap-3">
                      <img src={p.dataUrl} alt="" className="w-12 h-12 object-contain rounded border flex-shrink-0" style={{borderColor: t.border}}/>
                      <div className="flex-1 min-w-0">
                        <input value={mkcNames[p.key] ?? ""} onChange={e => setMkcNames(prev => ({...prev, [p.key]: e.target.value}))} disabled={!!mkBusy}
                          className="w-full text-sm rounded-lg px-3 py-1.5 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                        <div className="text-[10px] mt-0.5 truncate" style={{color: (mkcStatus[p.key] || "").startsWith("❌") ? "#EF4444" : t.textMuted}}>
                          {p.width}×{p.height} · {mkcStatus[p.key] || "Chờ upload"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-sm" style={{color: t.text}}>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{color: t.textMuted}}>Quyền xem</span>
                  <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={!mkPublic} onChange={() => setMkPublic(false)} disabled={!!mkBusy}/> Private</label>
                  <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={mkPublic} onChange={() => setMkPublic(true)} disabled={!!mkBusy}/> Public</label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {([["tags","Tags","tag1, tag2"],["productIds","Product IDs","id1, id2"],["angleCodes","Angle codes","ANGLE_1, ANGLE_2"],["marketTargets","Market targets","VN, US"],["languages","Languages","vi, en"]] as const).map(([k, label, ph]) => (
                    <div key={k}>
                      <label className="block text-xs mb-1" style={{color: t.textMuted}}>{label} <span className="opacity-70">(cách nhau dấu phẩy)</span></label>
                      <input value={mkcMeta[k]} onChange={e => setMkcMeta(prev => ({...prev, [k]: e.target.value}))} placeholder={ph} disabled={!!mkBusy}
                        className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                    </div>
                  ))}
                </div>
              </>
            )}

            {mkConn && mkModal === "template" && (
              <>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{color: t.textMuted}}>Tên template *</label>
                  <input value={mkTplName} onChange={e => setMkTplName(e.target.value)} disabled={!!mkBusy}
                    placeholder="Không trùng template Google khác"
                    className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500" style={inputStyle}/>
                  <div className="text-[10px] mt-1" style={{color: t.textMuted}}>
                    Định dạng: <b>App | NGÔN NGỮ-THỊ TRƯỜNG | keyword | ngày-giờ</b>. Trên MKT System gõ mã như &ldquo;VI-VN&rdquo; vào ô tìm để lọc theo ngôn ngữ.
                  </div>
                </div>
                {mkBlocks.map((b, i) => (
                  <div key={i} className="rounded-xl border p-3 space-y-2" style={{borderColor: t.border, backgroundColor: t.tabBg}}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{color: t.text}}>Khối {i + 1}</span>
                      {mkBlocks.length > 1 && (
                        <button onClick={() => setMkBlocks(prev => prev.filter((_, j) => j !== i))} className="text-[11px]" style={{color: t.textMuted}}>Xoá khối</button>
                      )}
                    </div>
                    {(["headlines","descriptions"] as const).map(f => (
                      <div key={f}>
                        <div className="text-[11px] mb-1" style={{color: t.textMuted}}>{f === "headlines" ? "Headlines — mỗi dòng một câu, ≤30 ký tự" : "Descriptions — mỗi dòng một câu, ≤90 ký tự"}</div>
                        <textarea value={b[f]} rows={f === "headlines" ? 4 : 3} disabled={!!mkBusy}
                          onChange={e => setMkBlocks(prev => prev.map((x, j) => j === i ? {...x, [f]: e.target.value} : x))}
                          className="w-full text-sm rounded-lg px-3 py-2 border focus:outline-none focus:border-violet-500 resize-y" style={inputStyle}/>
                      </div>
                    ))}
                  </div>
                ))}
                <button onClick={() => setMkBlocks(prev => [...prev, {headlines:"",descriptions:""}])} disabled={!!mkBusy}
                  className="text-xs px-3 py-1.5 rounded-lg border" style={{borderColor: t.border, color: t.textMuted}}>＋ Thêm khối</button>
                {mkBlockErrors().length > 0 && (
                  <div className="text-[11px] rounded-lg px-3 py-2 space-y-0.5" style={{backgroundColor:"#F59E0B14", color:"#F59E0B"}}>
                    <div className="font-semibold">⚠️ Chưa đủ điều kiện tạo campaign:</div>
                    {mkBlockErrors().map((e, i) => <div key={i}>• {e}</div>)}
                  </div>
                )}
              </>
            )}

            {mkError && <p className="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{mkError}</p>}
            {mkNote && <p className="text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 whitespace-pre-wrap" style={{color:"#10B981"}}>{mkNote}</p>}

            {mkConn && (
              <div className="flex gap-3">
                <button onClick={() => setMkModal(null)} disabled={!!mkBusy} className="px-4 py-2.5 rounded-xl border text-sm" style={{borderColor: t.border, color: t.textMuted}}>
                  {mkNote.startsWith("✅") ? "Đóng" : "Huỷ"}
                </button>
                {!mkNote.startsWith("✅") && (mkModal === "creative" ? (
                  <button onClick={mkUploadSelected} disabled={!!mkBusy || !abMkSel.length || abMkSel.some(k => !(mkcNames[k] || "").trim())}
                    className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{background: "linear-gradient(135deg,#059669,#10B981)"}}>
                    {mkBusy === "creative" ? "⏳ Đang upload..." : Object.keys(mkcStatus).length ? "↻ Upload lại" : `🖼 Upload ${abMkSel.length} creative`}
                  </button>
                ) : (
                  <button onClick={mkCreateTemplate} disabled={!!mkBusy || !mkTplName.trim() || mkBlockErrors().length > 0}
                    className="flex-1 text-sm font-semibold px-4 py-2.5 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{background: "linear-gradient(135deg,#7C3AED,#EC4899)"}}>
                    {mkBusy === "template" ? "⏳ Đang tạo..." : "📝 Tạo template"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {selectedPreview && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={()=>setSelectedPreview(null)}>
          <div className="rounded-2xl p-6 max-w-3xl w-full space-y-4 border" style={{...cardStyle, boxShadow:"0 25px 80px rgba(0,0,0,0.4)"}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold" style={{color: t.text}}>{selectedPreview.key} — {selectedPreview.label}</div>
                <div className="text-xs" style={{color: t.textMuted}}>{selectedPreview.width}×{selectedPreview.height}px</div>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>handleDownloadSingle(selectedPreview)} className="bg-violet-600 hover:bg-violet-500 text-white text-sm px-4 py-2 rounded-lg transition-all font-medium">⬇ Download PNG</button>
                <button onClick={()=>setSelectedPreview(null)} className="px-3 py-2 rounded-lg transition-colors" style={{color: t.textMuted}}>✕</button>
              </div>
            </div>
            <div className="flex items-center justify-center rounded-xl p-4 overflow-auto" style={{backgroundColor: isDark ? "#0A0A0F" : "#F1F5F9", maxHeight:"60vh"}}>
              <img src={selectedPreview.dataUrl} alt={selectedPreview.label} style={{maxWidth:"100%",maxHeight:"55vh",width:selectedPreview.width>600?"100%":"auto"}} className="rounded"/>
            </div>
          </div>
        </div>
      )}
      </div>{/* end main content */}
      </div>{/* end inner flex */}
    </div>
  );
}
