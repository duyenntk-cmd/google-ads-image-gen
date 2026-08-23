import { AD_SIZES, AdSize } from "./adSizes";

interface Brief {
  app_name?: string; headline?: string; subheadline?: string; cta_text?: string;
  primary_color?: string; secondary_color?: string; accent_color?: string;
  best_frame_index?: number; niche?: string;
  app_store_url?: string; play_store_url?: string;
  layout_suggestion?: string;
}

export interface GeneratedBanner {
  key: string; width: number; height: number; label: string;
  isTop5: boolean; dataUrl: string;
}

type Layout = "lifestyle" | "product" | "minimal" | "bold";

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const R = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + R, y);
  ctx.lineTo(x + w - R, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + R);
  ctx.lineTo(x + w, y + h - R);
  ctx.quadraticCurveTo(x + w, y + h, x + w - R, y + h);
  ctx.lineTo(x + R, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - R);
  ctx.lineTo(x, y + R);
  ctx.quadraticCurveTo(x, y, x + R, y);
  ctx.closePath();
}

async function ensureFontsLoaded(): Promise<string> {
  const fontName = "Inter";
  try {
    const fontDefs = [
      { weight: "400", url: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2" },
      { weight: "700", url: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYAZ9hiJ-Ek-_EeA.woff2" },
      { weight: "800", url: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hiJ-Ek-_EeA.woff2" },
    ];
    await Promise.all(fontDefs.map(async ({ weight, url }) => {
      const font = new FontFace(fontName, `url(${url}) format('woff2')`, { weight, style: "normal" });
      const loaded = await font.load();
      document.fonts.add(loaded);
    }));
    await document.fonts.ready;
  } catch { /* fallback to system fonts */ }
  return fontName;
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1), l2 = luminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Ensure CTA text color has good contrast
function getCtaTextColor(accentHex: string): string {
  return contrastRatio(accentHex, "#FFFFFF") >= 3 ? "#FFFFFF" : "#000000";
}

function variantBrief(brief: Brief, variantIndex: number): Brief {
  if (variantIndex === 0) return brief;
  const shifts = [
    {},
    { primary_color: brief.secondary_color, secondary_color: brief.primary_color },
    { primary_color: brief.accent_color, secondary_color: brief.primary_color, accent_color: brief.secondary_color },
    { primary_color: "#0F0F1A", secondary_color: brief.primary_color },
    { primary_color: brief.primary_color, secondary_color: brief.accent_color, accent_color: brief.secondary_color },
    { primary_color: "#1A0A2E", secondary_color: brief.secondary_color },
    { primary_color: brief.secondary_color, secondary_color: brief.accent_color, accent_color: brief.primary_color },
  ];
  return { ...brief, ...(shifts[variantIndex % shifts.length] || {}) };
}

function getLayout(brief: Brief, variantIndex: number): Layout {
  const suggestion = brief.layout_suggestion as Layout | undefined;
  const layouts: Layout[] = ["lifestyle", "product", "minimal", "bold"];
  if (variantIndex === 0 && suggestion) return suggestion;
  return layouts[variantIndex % layouts.length];
}

async function renderBanner(
  size: AdSize,
  brief: Brief,
  bgImg: HTMLImageElement | null,
  iconImg: HTMLImageElement | null,
  fontFamily: string,
  layout: Layout
): Promise<string> {
  const { width: w, height: h } = size;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const primary   = brief.primary_color   || "#0A0A14";
  const secondary = brief.secondary_color || "#1A1A2E";
  const accent    = brief.accent_color    || "#FF6B35";
  const headline  = (brief.headline       || "Your App").slice(0, 30);
  const subline   = (brief.subheadline    || "").slice(0, 60);
  const cta       = brief.cta_text        || "Try Free";
  const appName   = brief.app_name        || "";
  const isWide    = w > h * 2.5;
  const isTiny    = h <= 90;
  const pad       = Math.max(12, Math.round(Math.min(w, h) * 0.055));
  const clrShadow = () => { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  // ── BACKGROUND ──────────────────────────────────────────────────────────────
  if (layout === "minimal") {
    // Clean solid or subtle gradient background
    const grad = ctx.createLinearGradient(0, 0, w * 0.3, h);
    grad.addColorStop(0, primary);
    grad.addColorStop(1, secondary);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Subtle circle decoration
    if (!isTiny) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(w * (isWide ? 0.15 : 0.85), h * 0.15, Math.min(w, h) * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  } else if (layout === "bold") {
    // Bold: full color + diagonal split
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    if (isWide) {
      ctx.moveTo(0, 0); ctx.lineTo(w * 0.45, 0); ctx.lineTo(w * 0.3, h); ctx.lineTo(0, h);
    } else {
      ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.38); ctx.lineTo(0, h * 0.55);
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // Noise texture via tiny dots
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 3 + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // lifestyle / product: video frame full bleed
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, w, h);
    if (bgImg) {
      const scale = Math.max(w / bgImg.width, h / bgImg.height);
      const sw = bgImg.width * scale, sh = bgImg.height * scale;
      ctx.drawImage(bgImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
    }
    // Scrim
    if (!isTiny) {
      if (layout === "product") {
        // Product: stronger vignette + gradient on bottom
        const scrim = ctx.createLinearGradient(0, h * 0.2, 0, h);
        scrim.addColorStop(0, "rgba(0,0,0,0.1)");
        scrim.addColorStop(0.5, "rgba(0,0,0,0.6)");
        scrim.addColorStop(1, `rgba(${hexToRgb(primary).join(",")},0.95)`);
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 0, w, h);
      } else {
        // lifestyle: cinematic scrim
        if (isWide) {
          const scrim = ctx.createLinearGradient(w * 0.3, 0, w, 0);
          scrim.addColorStop(0, "rgba(0,0,0,0)");
          scrim.addColorStop(0.45, "rgba(0,0,0,0.65)");
          scrim.addColorStop(1, "rgba(0,0,0,0.9)");
          ctx.fillStyle = scrim; ctx.fillRect(0, 0, w, h);
        } else {
          const scrim = ctx.createLinearGradient(0, h * 0.25, 0, h);
          scrim.addColorStop(0, "rgba(0,0,0,0)");
          scrim.addColorStop(0.4, "rgba(0,0,0,0.55)");
          scrim.addColorStop(1, "rgba(0,0,0,0.93)");
          ctx.fillStyle = scrim; ctx.fillRect(0, 0, w, h);
        }
      }
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, w, h);
    }
  }

  // ── SIZES ───────────────────────────────────────────────────────────────────
  const hlSize  = isWide ? Math.max(10, Math.round(h * 0.28)) : isTiny ? Math.max(10, Math.round(h * 0.35)) : Math.max(18, Math.round(w * 0.08));
  const subSize = Math.max(10, Math.round(hlSize * 0.52));
  const nameSize= Math.max(9, Math.round(hlSize * 0.48));
  const ctaSize = Math.max(10, Math.min(22, Math.round(hlSize * 0.68)));
  const ctaH    = Math.max(28, Math.min(52, Math.round(hlSize * 1.05)));
  const ctaW    = isWide ? Math.min(200, Math.round(w * 0.22)) : Math.min(Math.round(w * 0.72), 280);
  const ctaR    = ctaH / 2;
  const ctaTextColor = getCtaTextColor(accent);

  // ── HELPERS ─────────────────────────────────────────────────────────────────
  const drawCta = (cx: number, cy: number) => {
    // Shadow glow
    ctx.shadowColor = accent + "88"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    ctx.fillStyle = accent;
    drawRoundRect(ctx, cx - ctaW / 2, cy - ctaH / 2, ctaW, ctaH, ctaR);
    ctx.fill();
    clrShadow();
    // Top shine
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    drawRoundRect(ctx, cx - ctaW / 2 + 2, cy - ctaH / 2 + 2, ctaW - 4, ctaH / 2 - 2, ctaR);
    ctx.fill();
    // Text
    ctx.font = `700 ${ctaSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = ctaTextColor;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 3;
    ctx.fillText(cta, cx, cy);
    ctx.textAlign = "left"; clrShadow();
  };

  const iconSize = Math.max(28, Math.round(Math.min(w, h) * (isWide ? 0.2 : 0.12)));

  const drawIcon = (x: number, y: number, size: number) => {
    if (!iconImg) return 0;
    const s = size;
    ctx.save();
    drawRoundRect(ctx, x, y - s / 2, s, s, s * 0.22);
    ctx.clip();
    ctx.drawImage(iconImg, x, y - s / 2, s, s);
    ctx.restore();
    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1.5;
    drawRoundRect(ctx, x, y - s / 2, s, s, s * 0.22);
    ctx.stroke();
    return s + 8;
  };

  const drawAppBadge = (x: number, y: number) => {
    if (!appName) return;
    ctx.font = `600 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
    const tw = ctx.measureText(appName).width;
    const ph = nameSize * 1.7, pw = tw + nameSize, pr = ph / 2;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1;
    drawRoundRect(ctx, x, y - ph / 2, pw, ph, pr);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4;
    ctx.fillText(appName, x + nameSize * 0.5, y);
    clrShadow();
  };

  const wrapText = (text: string, maxW: number, maxLines: number, size: number, weight = "700"): string[] => {
    ctx.font = `${weight} ${size}px "${fontFamily}", Arial, sans-serif`;
    const words = text.split(" ");
    let line = "", lines: string[] = [];
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, maxLines);
  };

  ctx.textBaseline = "middle";

  // ── TINY ────────────────────────────────────────────────────────────────────
  if (isTiny) {
    let tx = pad;
    const iconW = drawIcon(tx, h / 2, Math.round(h * 0.6));
    if (iconW) tx += iconW;
    else if (appName) {
      ctx.font = `700 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = "white";
      ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 4;
      ctx.fillText(appName, tx, h / 2);
      tx += ctx.measureText(appName).width + 10;
      clrShadow();
    }
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 4;
    let hl = headline;
    while (hl.length > 0 && ctx.measureText(hl).width > w - tx - ctaW - pad * 2) hl = hl.slice(0, -1);
    ctx.fillText(hl, tx, h / 2); clrShadow();
    drawCta(w - ctaW / 2 - pad, h / 2);

  // ── WIDE ────────────────────────────────────────────────────────────────────
  } else if (isWide) {
    const textX = Math.round(w * 0.5);
    const textMaxW = w - textX - pad * 1.5;
    const midY = h / 2;

    // Left side: icon or app tag
    if (iconImg) {
      drawIcon(pad, h / 2, iconSize);
    } else if (appName) {
      drawAppBadge(pad, pad + nameSize);
    }

    const hlLines = wrapText(headline, textMaxW, 2, hlSize);
    const hlBlockH = hlLines.length * hlSize * 1.2;
    const showSub = subline && layout !== "bold";
    const subBlockH = showSub ? subSize * 1.4 : 0;
    const totalH = hlBlockH + (showSub ? 8 : 0) + subBlockH + 12 + ctaH;
    const startY = midY - totalH / 2;

    // Headline
    const hlColor = layout === "minimal" ? "white" : "white";
    ctx.font = `800 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = hlColor;
    ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 10;
    hlLines.forEach((l, i) => ctx.fillText(l, textX, startY + hlSize * 0.6 + i * hlSize * 1.2));
    clrShadow();

    let curY = startY + hlBlockH;

    if (showSub) {
      curY += 8;
      ctx.font = `400 ${subSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6;
      let sub = subline;
      while (sub.length > 0 && ctx.measureText(sub).width > textMaxW) sub = sub.slice(0, -1);
      ctx.fillText(sub, textX, curY + subSize * 0.6); clrShadow();
      curY += subBlockH;
    }

    drawCta(textX + ctaW / 2, curY + 12 + ctaH / 2);

  // ── PORTRAIT / SQUARE ───────────────────────────────────────────────────────
  } else {
    const maxTW = w - pad * 2;
    const hlLines = wrapText(headline, maxTW, 3, hlSize);
    const hlBlockH = hlLines.length * hlSize * 1.15;
    const gap = Math.round(h * 0.025);
    const showSub = !!subline && h > 380 && layout !== "bold";
    const subBlockH = showSub ? subSize * 1.5 : 0;
    const totalH = hlBlockH + (showSub ? gap + subBlockH : 0) + gap * 2 + ctaH;
    const bottomPad = Math.round(h * 0.07);
    const startY = h - bottomPad - totalH;

    if (layout === "minimal" || layout === "bold") {
      // Top: icon left + app name right
      if (iconImg) {
        const is = Math.min(iconSize, h * 0.1);
        drawIcon(pad, pad + is / 2, is);
        if (appName) {
          ctx.font = `600 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillText(appName, pad + is + 8, pad + is / 2);
        }
      } else if (appName) {
        drawAppBadge(pad, pad + nameSize);
      }
    } else {
      // lifestyle/product: top-left app badge or icon
      if (iconImg && h > 300) {
        const is = Math.min(iconSize, h * 0.1);
        drawIcon(pad, pad + is / 2, is);
        if (appName) {
          ctx.font = `600 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
          ctx.fillStyle = "white";
          ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 6;
          ctx.fillText(appName, pad + is + 8, pad + is / 2);
          clrShadow();
        }
      } else if (appName && h > 200) {
        drawAppBadge(pad, pad + nameSize);
      }
    }

    // Headline
    ctx.font = `800 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2;
    hlLines.forEach((l, i) => ctx.fillText(l, pad, startY + hlSize * 0.6 + i * hlSize * 1.15));
    clrShadow();

    let curY = startY + hlBlockH;

    if (showSub) {
      curY += gap;
      ctx.font = `400 ${subSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = (layout as string) === "minimal" || (layout as string) === "bold" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.8)";
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 6;
      let sub = subline;
      while (sub.length > 0 && ctx.measureText(sub).width > maxTW) sub = sub.slice(0, -1);
      ctx.fillText(sub, pad, curY + subSize * 0.6); clrShadow();
      curY += subBlockH;
    }

    drawCta(w / 2, curY + gap * 2 + ctaH / 2);
  }

  // Subtle border
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  return canvas.toDataURL("image/png");
}

export async function generateAllBanners(
  brief: Brief,
  bgDataUrl: string | null,
  allFrameDataUrls?: string[],
  iconDataUrl?: string | null
): Promise<GeneratedBanner[]> {
  const fontFamily = await ensureFontsLoaded();

  const frameImgs: (HTMLImageElement | null)[] = [];
  if (allFrameDataUrls && allFrameDataUrls.length > 0) {
    for (const url of allFrameDataUrls) {
      try { frameImgs.push(await loadImage(url)); } catch { frameImgs.push(null); }
    }
  } else if (bgDataUrl) {
    try { frameImgs.push(await loadImage(bgDataUrl)); } catch { frameImgs.push(null); }
  }

  let iconImg: HTMLImageElement | null = null;
  if (iconDataUrl) {
    try { iconImg = await loadImage(iconDataUrl); } catch { iconImg = null; }
  }

  const results: GeneratedBanner[] = [];
  const groupCount: Record<string, number> = {};

  for (const size of AD_SIZES) {
    const g = size.group;
    const vi = groupCount[g] ?? 0;
    groupCount[g] = vi + 1;

    const frameImg = frameImgs.length > 0 ? (frameImgs[vi % frameImgs.length] ?? frameImgs[0]) : null;
    const vBrief = variantBrief(brief, vi);
    const layout = getLayout(brief, vi);

    const dataUrl = await renderBanner(size, vBrief, frameImg, iconImg, fontFamily, layout);
    results.push({ key: size.key, width: size.width, height: size.height, label: size.label, isTop5: size.isTop5, dataUrl });
  }
  return results;
}
