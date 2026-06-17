import { AD_SIZES, AdSize } from "./adSizes";

interface Brief {
  app_name?: string; headline?: string; subheadline?: string; cta_text?: string;
  primary_color?: string; secondary_color?: string; accent_color?: string;
  best_frame_index?: number; niche?: string;
  app_store_url?: string; play_store_url?: string;
}

export interface GeneratedBanner {
  key: string; width: number; height: number; label: string;
  isTop5: boolean; dataUrl: string;
}

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

async function ensureFontsLoaded(): Promise<string> {
  const fontName = "Inter";
  try {
    const fontDefs = [
      { weight: "400", url: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2" },
      { weight: "700", url: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYAZ9hiJ-Ek-_EeA.woff2" },
    ];
    await Promise.all(
      fontDefs.map(async ({ weight, url }) => {
        const font = new FontFace(fontName, `url(${url}) format('woff2')`, { weight, style: "normal" });
        const loaded = await font.load();
        document.fonts.add(loaded);
      })
    );
    await document.fonts.ready;
  } catch {
    // fallback to system fonts
  }
  return fontName;
}

// Variant tweaks: shift colors slightly for visual variety
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

async function renderBanner(size: AdSize, brief: Brief, bgImg: HTMLImageElement | null, fontFamily: string): Promise<string> {
  const { width: w, height: h } = size;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const primary  = brief.primary_color  || "#0A0A14";
  const accent   = brief.accent_color   || "#FF6B35";
  const headline = (brief.headline      || "Your App").slice(0, 52);
  const cta      = brief.cta_text       || "Try Free";
  const appName  = brief.app_name       || "";
  const isWide   = w > h * 2.5;
  const isTiny   = h <= 90;
  const pad      = Math.max(12, Math.round(Math.min(w, h) * 0.05));

  // === LAYER 1: Dark fallback bg ===
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, w, h);

  // === LAYER 2: Video frame full-bleed ===
  if (bgImg) {
    const scale = Math.max(w / bgImg.width, h / bgImg.height);
    const sw = bgImg.width * scale, sh = bgImg.height * scale;
    ctx.globalAlpha = 1;
    ctx.drawImage(bgImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
  }

  // === LAYER 3: Gradient scrim (bottom for portrait/square, right side for wide) ===
  if (!isTiny) {
    if (isWide) {
      // Wide: scrim on right half
      const scrim = ctx.createLinearGradient(w * 0.35, 0, w, 0);
      scrim.addColorStop(0, "rgba(0,0,0,0)");
      scrim.addColorStop(0.4, "rgba(0,0,0,0.65)");
      scrim.addColorStop(1, "rgba(0,0,0,0.88)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);
    } else {
      // Portrait/Square: scrim on bottom 55%
      const scrim = ctx.createLinearGradient(0, h * 0.3, 0, h);
      scrim.addColorStop(0, "rgba(0,0,0,0)");
      scrim.addColorStop(0.35, "rgba(0,0,0,0.55)");
      scrim.addColorStop(1, "rgba(0,0,0,0.92)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    // Tiny banner: full dark overlay
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, h);
  }

  const clrShadow = () => { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  // === TEXT SIZES ===
  const hlSize  = isWide ? Math.max(10, Math.round(h * 0.28)) : isTiny ? Math.max(10, Math.round(h * 0.35)) : Math.max(18, Math.round(w * 0.08));
  const subSize = Math.max(10, Math.round(hlSize * 0.55));
  const nameSize = Math.max(9, Math.round(hlSize * 0.52));
  const ctaSize = Math.max(10, Math.min(22, Math.round(hlSize * 0.7)));
  const ctaH    = Math.max(28, Math.min(52, Math.round(hlSize * 1.1)));
  const ctaW    = isWide ? Math.min(200, Math.round(w * 0.2)) : Math.min(Math.round(w * 0.7), 280);
  const ctaR    = ctaH / 2;

  ctx.textBaseline = "middle";

  // === DRAW CTA BUTTON ===
  const drawCta = (cx: number, cy: number) => {
    // Pill button with accent color
    ctx.fillStyle = accent;
    drawRoundRect(ctx, cx - ctaW / 2, cy - ctaH / 2, ctaW, ctaH, ctaR);
    ctx.fill();
    // White shimmer top edge
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    drawRoundRect(ctx, cx - ctaW / 2, cy - ctaH / 2, ctaW, ctaH, ctaR);
    ctx.stroke();
    // CTA text
    ctx.font = `700 ${ctaSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 4;
    ctx.fillText(cta, cx, cy);
    ctx.textAlign = "left"; clrShadow();
  };

  // === DRAW APP NAME TAG ===
  const drawAppTag = (x: number, y: number) => {
    ctx.font = `600 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
    const tw = ctx.measureText(appName).width;
    const ph = nameSize * 1.7, pw = tw + nameSize, pr = ph / 2;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1;
    drawRoundRect(ctx, x, y - ph / 2, pw, ph, pr);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4;
    ctx.fillText(appName, x + nameSize * 0.5, y);
    clrShadow();
    return pw;
  };

  // === WRAP HEADLINE ===
  const wrapText = (text: string, maxW: number, maxLines: number): string[] => {
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    const words = text.split(" ");
    let line = "", lines: string[] = [];
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, maxLines);
  };

  if (isWide) {
    // Wide: text on right side
    const textX = Math.round(w * 0.52);
    const textMaxW = w - textX - pad;
    const midY = h / 2;

    const hlLines = wrapText(headline, textMaxW, 2);
    const hlBlockH = hlLines.length * hlSize * 1.2;
    const totalH = hlBlockH + 12 + ctaH;
    const startY = midY - totalH / 2;

    // App name tag top-left
    if (appName) drawAppTag(pad, pad + nameSize);

    // Headline
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 10;
    hlLines.forEach((l, i) => ctx.fillText(l, textX, startY + hlSize * 0.6 + i * hlSize * 1.2));
    clrShadow();

    // CTA
    drawCta(textX + ctaW / 2, startY + hlBlockH + 12 + ctaH / 2);

  } else if (isTiny) {
    // Tiny banner: app name | headline | CTA in a row
    let tx = pad;
    if (appName) {
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
    // Truncate headline to fit
    let hl = headline;
    while (hl.length > 0 && ctx.measureText(hl).width > w - tx - ctaW - pad * 2) hl = hl.slice(0, -1);
    ctx.fillText(hl, tx, h / 2);
    clrShadow();
    drawCta(w - ctaW / 2 - pad, h / 2);

  } else {
    // Portrait / Square: content anchored to bottom
    const maxTW = w - pad * 2;
    const hlLines = wrapText(headline, maxTW, 3);
    const hlBlockH = hlLines.length * hlSize * 1.15;
    const gap = Math.round(h * 0.025);
    const showSub = brief.subheadline && h > 400;
    const subBlockH = showSub ? subSize * 1.4 : 0;
    const totalH = hlBlockH + (showSub ? gap + subBlockH : 0) + gap * 2 + ctaH;
    const bottomPad = Math.round(h * 0.06);
    const startY = h - bottomPad - totalH;

    // App name tag — top left
    if (appName && h > 200) drawAppTag(pad, pad + nameSize);

    // Headline
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2;
    hlLines.forEach((l, i) => ctx.fillText(l, pad, startY + hlSize * 0.6 + i * hlSize * 1.15));
    clrShadow();

    let curY = startY + hlBlockH;

    // Subheadline
    if (showSub) {
      curY += gap;
      ctx.font = `400 ${subSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.80)";
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 6;
      let subText = brief.subheadline!;
      while (subText.length > 0 && ctx.measureText(subText).width > maxTW) subText = subText.slice(0, -1);
      ctx.fillText(subText, pad, curY + subSize * 0.6);
      clrShadow();
      curY += subBlockH;
    }

    // CTA
    curY += gap * 2;
    drawCta(w / 2, curY + ctaH / 2);
  }

  // Subtle border
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  return canvas.toDataURL("image/png");
}

export async function generateAllBanners(brief: Brief, bgDataUrl: string | null, allFrameDataUrls?: string[]): Promise<GeneratedBanner[]> {
  const fontFamily = await ensureFontsLoaded();

  // Load all frame images for variety
  const frameImgs: (HTMLImageElement | null)[] = [];
  if (allFrameDataUrls && allFrameDataUrls.length > 0) {
    for (const url of allFrameDataUrls) {
      try { frameImgs.push(await loadImage(url)); } catch { frameImgs.push(null); }
    }
  } else if (bgDataUrl) {
    try { frameImgs.push(await loadImage(bgDataUrl)); } catch { frameImgs.push(null); }
  }

  const results: GeneratedBanner[] = [];
  // Track variant index per group
  const groupCount: Record<string, number> = {};

  for (const size of AD_SIZES) {
    const g = size.group;
    const vi = groupCount[g] ?? 0;
    groupCount[g] = vi + 1;

    // Pick a different frame for each variant
    const frameImg = frameImgs.length > 0 ? (frameImgs[vi % frameImgs.length] ?? frameImgs[0]) : null;
    const vBrief = variantBrief(brief, vi);

    const dataUrl = await renderBanner(size, vBrief, frameImg, fontFamily);
    results.push({ key: size.key, width: size.width, height: size.height, label: size.label, isTop5: size.isTop5, dataUrl });
  }
  return results;
}
