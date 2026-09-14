"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";
import { AD_SIZES, GEN_SIZES, pickBaseRatio, RatioKey } from "@/lib/adSizes";

/* ----------------------------- types ----------------------------- */
interface AppInfo {
  appName: string;
  iconBase64: string | null;
  screenshots: string[];
}
interface Brief {
  app_name: string;
  tagline: string;
  headline: string;
  subheadline: string;
  cta_text: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  mood: string;
  niche: string;
  text_zone: string;
  subject_position: string;
}
interface FinalBanner {
  key: string;
  width: number;
  height: number;
  usage: string;
  dataUrl: string;
}

/* ----------------------------- generic helpers ----------------------------- */
async function safeJson(res: Response, label: string) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: phản hồi không hợp lệ (HTTP ${res.status}) ${text.slice(0, 160)}`);
  }
}
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Không load được ảnh."));
    img.src = src;
  });
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Đọc file lỗi."));
    r.readAsDataURL(file);
  });
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return [26, 26, 46];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexA(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function contrastColor(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#141414" : "#ffffff";
}
function lighten(hex: string, amt: number) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

/* ----------------------------- drawing pieces ----------------------------- */
// Logo lockup: frosted chip + rounded icon + app name (+ tagline).
function drawLogoLockup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  iconImg: HTMLImageElement | null,
  appName: string,
  tagline: string,
  scale: number,
) {
  const iconS = Math.round(44 * scale);
  const gap = Math.round(10 * scale);
  const nameFs = Math.round(24 * scale);
  const tagFs = Math.round(12 * scale);
  ctx.font = `800 ${nameFs}px system-ui, Arial, sans-serif`;
  const nameW = ctx.measureText(appName).width;
  ctx.font = `500 ${tagFs}px system-ui, Arial, sans-serif`;
  const tagW = tagline ? ctx.measureText(tagline).width : 0;
  const textW = Math.max(nameW, tagW);
  const padX = Math.round(12 * scale);
  const padY = Math.round(10 * scale);
  const chipW = padX * 2 + (iconImg ? iconS + gap : 0) + textW;
  const chipH = padY * 2 + Math.max(iconS, nameFs + (tagline ? tagFs + 4 * scale : 0));

  // frosted chip for legibility on any background
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 18 * scale;
  ctx.shadowOffsetY = 4 * scale;
  ctx.fillStyle = "rgba(12,12,22,0.42)";
  roundedRectPath(ctx, x, y, chipW, chipH, chipH * 0.28);
  ctx.fill();
  ctx.restore();

  let cx = x + padX;
  const midY = y + chipH / 2;
  if (iconImg) {
    const iy = midY - iconS / 2;
    ctx.save();
    roundedRectPath(ctx, cx, iy, iconS, iconS, iconS * 0.24);
    ctx.clip();
    ctx.drawImage(iconImg, cx, iy, iconS, iconS);
    ctx.restore();
    cx += iconS + gap;
  }
  if (tagline) {
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${nameFs}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(appName, cx, midY + nameFs * 0.05);
    ctx.font = `500 ${tagFs}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillText(ellipsize(ctx, tagline, chipW - (cx - x) - padX), cx, midY + nameFs * 0.05 + tagFs + 4 * scale);
  } else {
    ctx.textBaseline = "middle";
    ctx.font = `800 ${nameFs}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(appName, cx, midY);
  }
  return { w: chipW, h: chipH };
}

// CTA pill: accent bg, left circle w/ download arrow, centered label, right chevron.
function drawCTA(ctx: CanvasRenderingContext2D, x: number, y: number, maxW: number, label: string, accent: string, scale: number) {
  const fs = clamp(Math.round(22 * scale), 12, 46);
  ctx.font = `bold ${fs}px system-ui, Arial, sans-serif`;
  const labelW = ctx.measureText(label).width;
  const circle = fs * 1.5;
  const chev = fs * 0.9;
  const gap = fs * 0.6;
  const bh = Math.round(fs * 2.2);
  let bw = circle + gap + labelW + gap + chev + fs * 1.2;
  bw = Math.min(bw, maxW);
  const bx = x;
  const by = y;

  ctx.save();
  ctx.shadowColor = hexA(accent, 0.5);
  ctx.shadowBlur = 22 * scale;
  ctx.shadowOffsetY = 6 * scale;
  const grad = ctx.createLinearGradient(bx, by, bx + bw, by);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, lighten(accent, 0.18));
  ctx.fillStyle = grad;
  roundedRectPath(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  ctx.restore();

  const cc = contrastColor(accent);
  // left circle + download arrow
  const ccx = bx + bh / 2;
  const ccy = by + bh / 2;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(ccx, ccy, circle / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = cc;
  ctx.lineWidth = Math.max(2, fs * 0.11);
  ctx.lineCap = "round";
  const a = circle * 0.24;
  ctx.beginPath();
  ctx.moveTo(ccx, ccy - a);
  ctx.lineTo(ccx, ccy + a * 0.7);
  ctx.moveTo(ccx - a * 0.6, ccy + a * 0.1);
  ctx.lineTo(ccx, ccy + a * 0.7);
  ctx.lineTo(ccx + a * 0.6, ccy + a * 0.1);
  ctx.moveTo(ccx - a * 0.9, ccy + a * 0.9);
  ctx.lineTo(ccx + a * 0.9, ccy + a * 0.9);
  ctx.stroke();

  // label
  ctx.fillStyle = cc;
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fs}px system-ui, Arial, sans-serif`;
  const labelX = bx + bh + gap;
  ctx.fillText(ellipsize(ctx, label, bw - bh - chev - fs * 1.6), labelX, ccy + 1);

  // right chevron
  const chx = bx + bw - fs * 1.1;
  ctx.beginPath();
  ctx.moveTo(chx - chev * 0.3, ccy - chev * 0.5);
  ctx.lineTo(chx + chev * 0.3, ccy);
  ctx.lineTo(chx - chev * 0.3, ccy + chev * 0.5);
  ctx.stroke();

  return { w: bw, h: bh };
}

// Simplified "GET IT ON Google Play" badge.
function drawPlayBadge(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  const bh = Math.round(46 * scale);
  const bw = Math.round(150 * scale);
  ctx.save();
  ctx.fillStyle = "#000000";
  roundedRectPath(ctx, x, y, bw, bh, Math.round(8 * scale));
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, scale);
  roundedRectPath(ctx, x, y, bw, bh, Math.round(8 * scale));
  ctx.stroke();

  // play triangle (colored)
  const tx = x + bh * 0.28;
  const ty = y + bh / 2;
  const s = bh * 0.28;
  const tri = [
    ["#00D2FF", 0],
    ["#FF3D00", 0],
  ];
  ctx.fillStyle = "#00E0FF";
  ctx.beginPath();
  ctx.moveTo(tx - s * 0.7, ty - s);
  ctx.lineTo(tx - s * 0.7, ty + s);
  ctx.lineTo(tx + s * 0.9, ty);
  ctx.closePath();
  ctx.fillStyle = "#12B5FF";
  ctx.fill();
  void tri;

  const textX = x + bh * 0.95;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 ${Math.round(9 * scale)}px system-ui, Arial, sans-serif`;
  ctx.fillText("GET IT ON", textX, y + bh * 0.42);
  ctx.font = `700 ${Math.round(17 * scale)}px system-ui, Arial, sans-serif`;
  ctx.fillText("Google Play", textX, y + bh * 0.82);
  ctx.restore();
}

/* ----------------------------- text block (hook + sub) ----------------------------- */
function drawMarketingText(ctx: CanvasRenderingContext2D, w: number, h: number, brief: Brief, scale: number): number {
  const secondary = brief.secondary_color || "#1A1A2E";
  const accent = brief.accent_color || "#FF6B35";
  const headline = brief.headline || brief.app_name || "";
  const sub = brief.subheadline || "";
  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.06));
  const isStrip = h <= 120;
  ctx.textAlign = "left";

  if (isStrip) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, hexA(secondary, 0.94));
    g.addColorStop(1, hexA(secondary, 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const fs = Math.round(h * 0.34);
    ctx.textBaseline = "middle";
    ctx.font = `800 ${fs}px system-ui, Arial, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(ellipsize(ctx, headline, w - pad * 2), pad, h / 2);
    return h; // strips: CTA handled by caller area check (skipped)
  }

  const scrimH = Math.round(h * (h / w >= 1.4 ? 0.52 : 0.6));
  const g = ctx.createLinearGradient(0, h - scrimH, 0, h);
  g.addColorStop(0, hexA(secondary, 0));
  g.addColorStop(0.45, hexA(secondary, 0.6));
  g.addColorStop(1, hexA(secondary, 0.96));
  ctx.fillStyle = g;
  ctx.fillRect(0, h - scrimH, w, scrimH);

  const maxW = w - pad * 2;
  let y = h - pad;

  // reserve space for CTA + play badge; those are drawn by caller. Return the top Y where text ends.
  // headline (two-tone: last line accent) + subheadline, drawn bottom-up above the CTA zone.
  const ctaZone = Math.round(64 * scale) + Math.round(52 * scale) + pad; // cta + badge + gap
  y -= ctaZone;

  if (sub && h >= 250) {
    const fs = clamp(Math.round(w * 0.04), 12, 32);
    ctx.font = `500 ${fs}px system-ui, Arial, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    const lines = wrapText(ctx, sub, maxW).slice(0, 2);
    for (let i = lines.length - 1; i >= 0; i--) {
      ctx.fillText(lines[i], pad, y);
      y -= fs * 1.3;
    }
    y -= fs * 0.3;
  }

  if (headline) {
    const fs = clamp(Math.round(w * 0.082), 16, 80);
    ctx.font = `900 ${fs}px system-ui, Arial, sans-serif`;
    ctx.textBaseline = "alphabetic";
    const lines = wrapText(ctx, headline, maxW).slice(0, 2);
    for (let i = lines.length - 1; i >= 0; i--) {
      ctx.fillStyle = lines.length > 1 && i === lines.length - 1 ? lighten(accent, 0.15) : "#ffffff";
      ctx.fillText(lines[i], pad, y);
      y -= fs * 1.12;
    }
  }
  return y;
}

/* ----------------------------- final banner assembly ----------------------------- */
function renderFinalBanner(
  baseImg: HTMLImageElement,
  w: number,
  h: number,
  brief: Brief,
  iconImg: HTMLImageElement | null,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // resize base
  const srcRatio = baseImg.width / baseImg.height;
  const dstRatio = w / h;
  if (Math.abs(srcRatio - dstRatio) < 0.15) {
    ctx.drawImage(baseImg, 0, 0, w, h);
  } else {
    ctx.save();
    ctx.filter = "blur(28px)";
    const cs = Math.max(w / baseImg.width, h / baseImg.height);
    ctx.drawImage(baseImg, (w - baseImg.width * cs) / 2, (h - baseImg.height * cs) / 2, baseImg.width * cs, baseImg.height * cs);
    ctx.restore();
    const cs2 = Math.min(w / baseImg.width, h / baseImg.height);
    ctx.drawImage(baseImg, (w - baseImg.width * cs2) / 2, (h - baseImg.height * cs2) / 2, baseImg.width * cs2, baseImg.height * cs2);
  }

  const scale = clamp(Math.min(w, h) / 500, 0.34, 2.2);
  const isStrip = h <= 120;
  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.06));

  // text block (hook + sub) + scrim
  drawMarketingText(ctx, w, h, brief, scale);

  if (isStrip) {
    // strip: just a compact CTA on the right
    if (brief.cta_text) {
      const est = 160 * scale;
      drawCTA(ctx, w - pad - est, (h - 46 * scale) / 2, est, brief.cta_text, brief.accent_color || "#FF6B35", scale * 0.7);
    }
    return canvas.toDataURL("image/png");
  }

  // logo lockup top-left
  drawLogoLockup(ctx, pad, pad, iconImg, brief.app_name, brief.tagline, scale);

  // CTA + Play badge bottom-left
  const ctaScale = scale;
  const cta = drawCTA(ctx, pad, h - pad - Math.round(46 * ctaScale) - Math.round(52 * ctaScale) - pad * 0.4, w - pad * 2, brief.cta_text || "Download", brief.accent_color || "#FF6B35", ctaScale);
  if (h >= 320 && w >= 300) {
    drawPlayBadge(ctx, pad, h - pad - Math.round(46 * scale), scale);
    void cta;
  }

  return canvas.toDataURL("image/png");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/:(.*?);/)?.[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ----------------------------- options ----------------------------- */
const COUNTRIES = ["Global", "Vietnam", "Indonesia", "United States", "India", "Thailand", "Philippines", "Saudi Arabia"];
const LANGUAGES = ["Vietnamese", "English", "Indonesian", "Arabic"];
const NICHES = ["photo", "tool", "office", "game", "health", "finance", "social", "travel", "education"];
const QUALITIES: { v: "low" | "medium" | "high"; label: string }[] = [
  { v: "low", label: "Low (nhanh)" },
  { v: "medium", label: "Medium" },
  { v: "high", label: "High (đẹp nhất)" },
];

/* ----------------------------- page ----------------------------- */
export default function Home() {
  const [appUrl, setAppUrl] = useState("");
  const [country, setCountry] = useState("Global");
  const [language, setLanguage] = useState("Vietnamese");
  const [niche, setNiche] = useState("photo");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("high");
  const [useScreenshot, setUseScreenshot] = useState(true);
  const [userPrompt, setUserPrompt] = useState("");
  const [autoMascot, setAutoMascot] = useState(true);
  const [characterImage, setCharacterImage] = useState<string | null>(null);
  const [mascotUsed, setMascotUsed] = useState<string | null>(null);
  const charInputRef = useRef<HTMLInputElement>(null);

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [banners, setBanners] = useState<FinalBanner[]>([]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function onCharFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCharacterImage(await fileToDataUrl(f));
  }

  async function fetchApp() {
    setError("");
    setAppInfo(null);
    setBanners([]);
    if (!appUrl.trim()) return setError("Nhập URL App Store hoặc Play Store.");
    setBusy(true);
    setStatus("Đang lấy thông tin app từ store...");
    try {
      const res = await fetch("/api/screenshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appUrl: appUrl.trim(), country }),
      });
      const data = await safeJson(res, "screenshots");
      if (!data.success) throw new Error(data.error || "Fetch app thất bại.");
      setAppInfo({ appName: data.appName, iconBase64: data.iconBase64, screenshots: data.screenshots || [] });
      setStatus(`Đã lấy "${data.appName}" — ${data.screenshots?.length || 0} screenshots.`);
    } catch (e: any) {
      setError(e.message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function autoPrompt() {
    if (!appInfo) return setError("Fetch app trước đã.");
    setError("");
    setBusy(true);
    setStatus("Auto Prompt: GPT đang viết creative direction...");
    try {
      const res = await fetch("/api/auto-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: appInfo.appName, niche, screenshots: appInfo.screenshots, country, language }),
      });
      const data = await safeJson(res, "auto-prompt");
      if (!data.success) throw new Error(data.error || "Auto Prompt thất bại.");
      setUserPrompt(data.prompt || "");
      setStatus("Đã điền creative direction. Chỉnh sửa nếu muốn rồi bấm Generate.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!appInfo) return setError("Fetch app trước đã.");
    setError("");
    setBanners([]);
    setBusy(true);
    try {
      setStatus("Đang tạo design brief (GPT-4o)...");
      const briefRes = await fetch("/api/banner-concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: appInfo.appName,
          prompt: userPrompt,
          country,
          language,
          screenshots: appInfo.screenshots,
          appUrl,
        }),
      });
      const briefData = await safeJson(briefRes, "banner-concept");
      if (!briefData.success) throw new Error(briefData.error || "Tạo brief thất bại.");
      const theBrief: Brief = { ...briefData.brief, niche: briefData.brief.niche || niche };
      setBrief(theBrief);

      // Resolve mascot: manual upload wins; otherwise auto-find in screenshots or generate one.
      let mascot: string | null = characterImage;
      if (!mascot && autoMascot) {
        setStatus("Đang tìm mascot trong screenshots (hoặc tạo mới)...");
        try {
          const mres = await fetch("/api/mascot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              appName: appInfo.appName,
              niche: theBrief.niche,
              screenshots: appInfo.screenshots,
              brief: theBrief,
              quality,
            }),
          });
          const md = await safeJson(mres, "mascot");
          if (md.success) {
            mascot = md.source === "screenshot" ? appInfo.screenshots[md.index] || null : md.dataUrl || null;
          }
        } catch {
          /* non-fatal: continue without a mascot reference */
        }
      }
      setMascotUsed(mascot);

      const referenceImages = useScreenshot ? appInfo.screenshots.slice(0, 1) : [];
      setStatus("Đang gen 3 ảnh base bằng gpt-image-1 (nhân vật + UI thật)... chờ ~40-80s");
      const genResults = await Promise.allSettled(
        (["portrait", "square", "landscape"] as RatioKey[]).map((ratioKey) =>
          fetch("/api/banner-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ brief: theBrief, userPrompt, quality, ratioKey, referenceImages, characterImage: mascot }),
          }).then((r) => safeJson(r, `banner-generate:${ratioKey}`)),
        ),
      );

      const baseByRatio: Partial<Record<RatioKey, HTMLImageElement>> = {};
      const failures: string[] = [];
      for (let i = 0; i < genResults.length; i++) {
        const r = genResults[i];
        const ratioKey = (["portrait", "square", "landscape"] as RatioKey[])[i];
        if (r.status === "fulfilled" && r.value?.success && r.value.images?.[0]?.dataUrl) {
          baseByRatio[ratioKey] = await loadImg(r.value.images[0].dataUrl);
        } else {
          const reason = r.status === "rejected" ? r.reason?.message : r.value?.error || "unknown";
          failures.push(`${ratioKey}: ${reason}`);
        }
      }
      if (!Object.keys(baseByRatio).length) throw new Error("Không gen được ảnh base nào.\n" + failures.join("\n"));

      const iconImg = appInfo.iconBase64 ? await loadImg(appInfo.iconBase64) : null;

      setStatus("Đang overlay logo + hook + CTA + Play badge ra 8 kích thước...");
      const out: FinalBanner[] = [];
      for (const sz of AD_SIZES) {
        const ratio = pickBaseRatio(sz.width, sz.height);
        const baseImg = baseByRatio[ratio] || baseByRatio.square || baseByRatio.portrait || baseByRatio.landscape;
        if (!baseImg) continue;
        const dataUrl = renderFinalBanner(baseImg, sz.width, sz.height, theBrief, iconImg);
        out.push({ key: sz.key, width: sz.width, height: sz.height, usage: sz.usage, dataUrl });
      }

      setBanners(out);
      setStatus(`Xong: ${out.length} banner.` + (failures.length ? ` (Một số ratio lỗi: ${failures.length})` : ""));
      if (failures.length) setError("Cảnh báo:\n" + failures.join("\n"));
    } catch (e: any) {
      setError(e.message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function downloadZip() {
    if (!banners.length) return;
    const zip = new JSZip();
    const folderName = (brief?.app_name || appInfo?.appName || "banners").replace(/[^\w-]+/g, "_");
    const folder = zip.folder(folderName)!;
    banners.forEach((b) => folder.file(`${b.key}.png`, dataUrlToBlob(b.dataUrl)));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folderName}_google_ads_banners.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="bg-gradient-to-r from-fuchsia-400 via-purple-400 to-orange-400 bg-clip-text text-3xl font-black text-transparent sm:text-4xl">
          Google Ads Banner Generator
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          URL app + nhân vật branding → AI gen scene → overlay logo / hook / CTA / Play badge → 8 size chuẩn → ZIP.
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          URL App Store / Play Store
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            placeholder="https://play.google.com/store/apps/details?id=... hoặc https://apps.apple.com/..."
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-fuchsia-400"
          />
          <button
            onClick={fetchApp}
            disabled={busy}
            className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-semibold hover:bg-fuchsia-500 disabled:opacity-50"
          >
            Fetch app
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select label="Quốc gia" value={country} onChange={setCountry} options={COUNTRIES} />
          <Select label="Ngôn ngữ" value={language} onChange={setLanguage} options={LANGUAGES} />
          <Select label="Niche" value={niche} onChange={setNiche} options={NICHES} />
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Quality</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as any)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
            >
              {QUALITIES.map((q) => (
                <option key={q.v} value={q.v} className="bg-[#12121e]">
                  {q.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* character branding — auto by default */}
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={autoMascot}
              onChange={(e) => setAutoMascot(e.target.checked)}
              className="h-4 w-4 accent-fuchsia-500"
            />
            Tự động tìm / tạo mascot
          </label>
          <p className="mt-1 pl-6 text-xs text-slate-400">
            Tool sẽ tìm nhân vật trong screenshots của app; nếu không có thì tự tạo 1 mascot và tái dùng cho mọi banner.
          </p>

          <div className="mt-3 flex items-center gap-3">
            {mascotUsed || characterImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={(characterImage || mascotUsed) as string} alt="mascot" className="h-16 w-16 rounded-lg object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-white/20 text-2xl">🤖</div>
            )}
            <div className="flex-1">
              <p className="text-xs text-slate-400">
                {characterImage
                  ? "Đang dùng mascot bạn upload (override auto)."
                  : mascotUsed
                    ? "Mascot tool đã dùng ở lần gen gần nhất."
                    : "Không bắt buộc: có thể tự chọn 1 ảnh mascot để ghi đè auto."}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => charInputRef.current?.click()}
                  className="rounded-md bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
                >
                  Chọn ảnh (tùy chọn)
                </button>
                {characterImage && (
                  <button
                    onClick={() => setCharacterImage(null)}
                    className="rounded-md bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
                  >
                    Bỏ override
                  </button>
                )}
              </div>
              <input ref={charInputRef} type="file" accept="image/*" hidden onChange={onCharFile} />
            </div>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={useScreenshot}
            onChange={(e) => setUseScreenshot(e.target.checked)}
            className="h-4 w-4 accent-fuchsia-500"
          />
          Dùng screenshot thật của app trong phone mockup
        </label>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Creative direction (prompt)
            </label>
            <button
              onClick={autoPrompt}
              disabled={busy || !appInfo}
              className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40"
            >
              ✨ Auto Prompt
            </button>
          </div>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            rows={3}
            placeholder="VD: nền gradient tím sáng, mascot vui vẻ chỉ tay, bong bóng chat có cờ các nước, cảm hứng học ngôn ngữ."
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-fuchsia-400"
          />
        </div>

        <button
          onClick={generate}
          disabled={busy || !appInfo}
          className="mt-4 w-full rounded-lg bg-gradient-to-r from-fuchsia-600 to-orange-500 px-4 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Đang xử lý..." : "Generate banners"}
        </button>
      </section>

      {status && <p className="mt-4 text-sm text-emerald-300">{status}</p>}
      {error && (
        <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </pre>
      )}

      {appInfo && (
        <section className="mt-6 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
          {appInfo.iconBase64 && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={appInfo.iconBase64} alt="icon" className="h-12 w-12 rounded-xl" />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold">{appInfo.appName}</p>
            <p className="text-xs text-slate-400">{appInfo.screenshots.length} screenshots</p>
          </div>
        </section>
      )}

      {brief && (
        <section className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <Field k="Tagline" v={brief.tagline} />
            <Field k="Headline" v={brief.headline} />
            <Field k="Subheadline" v={brief.subheadline} />
            <Field k="CTA" v={brief.cta_text} />
            <Field k="Mood" v={brief.mood} />
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Colors:</span>
              <Swatch c={brief.primary_color} />
              <Swatch c={brief.secondary_color} />
              <Swatch c={brief.accent_color} />
            </div>
          </div>
        </section>
      )}

      {banners.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">{banners.length} banners</h2>
            <button
              onClick={downloadZip}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
            >
              ⬇ Download ZIP
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {banners.map((b) => (
              <div key={b.key} className="rounded-xl border border-white/10 bg-black/30 p-2">
                <div
                  className="mb-2 flex items-center justify-center overflow-hidden rounded-lg bg-black/40"
                  style={{ aspectRatio: `${b.width}/${b.height}` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.dataUrl} alt={b.key} className="max-h-40 w-full object-contain" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold">{b.key}</p>
                    <p className="text-[10px] text-slate-500">{b.usage}</p>
                  </div>
                  <a href={b.dataUrl} download={`${b.key}.png`} className="rounded-md bg-white/10 px-2 py-1 text-[10px] hover:bg-white/20">
                    PNG
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-12 text-center text-xs text-slate-600">
        gpt-image-1 (scene + nhân vật) · Canvas (logo / hook / CTA / Play badge) · Google Ads sizes
      </footer>
    </main>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-[#12121e]">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
function Field({ k, v }: { k: string; v: string }) {
  return (
    <p className="truncate">
      <span className="text-slate-400">{k}:</span> <span className="font-medium">{v || "—"}</span>
    </p>
  );
}
function Swatch({ c }: { c: string }) {
  return <span className="inline-block h-4 w-4 rounded border border-white/20" style={{ background: c }} title={c} />;
}
