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

async function renderBanner(size: AdSize, brief: Brief, bgImg: HTMLImageElement | null, fontFamily: string): Promise<string> {
  const { width: w, height: h } = size;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const primary    = brief.primary_color    || "#1A1A2E";
  const secondary  = brief.secondary_color  || "#7B2FBE";
  const accent     = brief.accent_color     || "#FF6B35";
  const headline   = (brief.headline        || "Your App").slice(0, 52);
  const sub        = (brief.subheadline     || "").slice(0, 60);
  const cta        = brief.cta_text         || "Try Free";
  const appName    = brief.app_name         || "";
  const isWide     = w > h * 3;
  const isTall     = !isWide && h > w * 1.5;
  const isTiny     = h <= 60;
  const pad        = Math.max(8, Math.round(Math.min(w, h) * 0.05));

  // Gradient BG
  const grad = ctx.createLinearGradient(0, 0, isWide ? w : 0, isWide ? 0 : h);
  grad.addColorStop(0, primary);
  grad.addColorStop(1, secondary);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // BG image
  if (bgImg) {
    const scale = Math.max(w / bgImg.width, h / bgImg.height);
    const sw = bgImg.width * scale, sh = bgImg.height * scale;
    ctx.globalAlpha = 0.42;
    ctx.drawImage(bgImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
    ctx.globalAlpha = 1;
  }

  // Decorative circles (depth effect)
  if (!isTiny) {
    const circles = [
      { x: w * 0.85, y: h * 0.15, r: Math.min(w, h) * 0.45, color: accent, alpha: 0.10 },
      { x: w * 0.1,  y: h * 0.75, r: Math.min(w, h) * 0.35, color: secondary, alpha: 0.12 },
      { x: w * 0.55, y: h * 0.5,  r: Math.min(w, h) * 0.25, color: primary, alpha: 0.08 },
    ];
    for (const c of circles) {
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Overlay
  const ov = ctx.createLinearGradient(0, 0, 0, h);
  ov.addColorStop(0, "rgba(0,0,0,0)");
  ov.addColorStop(0.45, primary + "99");
  ov.addColorStop(1, primary + "f0");
  ctx.fillStyle = ov;
  ctx.fillRect(0, 0, w, h);

  const setShadow = () => { ctx.shadowColor = "rgba(0,0,0,0.95)"; ctx.shadowBlur = 8; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 2; };
  const clrShadow = () => { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  const hlSize   = isWide ? Math.max(9, Math.round(h / 3.2))    : isTall ? Math.max(13, Math.round(w * 0.095)) : Math.max(10, Math.round(h * 0.105));
  const subSize  = Math.max(8,  Math.round(hlSize * 0.65));
  const nameSize = Math.max(9,  Math.round(hlSize * 0.7));
  const ctaSize  = Math.max(9,  Math.min(18, Math.round(hlSize * 0.85)));
  const ctaW     = Math.min(Math.round(w * (isWide ? 0.18 : 0.65)), 180);
  const ctaH     = Math.max(22, Math.min(38, Math.round(h * (isTall ? 0.07 : 0.14))));
  const ctaR     = ctaH / 2.5;

  ctx.textBaseline = "middle";

  // Helper: draw CTA button with gradient + glassmorphism
  const drawCtaButton = (cx: number, cy: number, bw: number, bh: number, br: number) => {
    // Gradient fill
    const ctaGrad = ctx.createLinearGradient(cx, cy - bh / 2, cx + bw, cy + bh / 2);
    ctaGrad.addColorStop(0, accent);
    // Lighten accent by ~30%
    const accentLighter = accent + "cc";
    ctaGrad.addColorStop(1, accentLighter);
    ctx.fillStyle = ctaGrad;
    drawRoundRect(ctx, cx, cy - bh / 2, bw, bh, br); ctx.fill();
    // White border (20% opacity)
    ctx.strokeStyle = "rgba(255,255,255,0.20)";
    ctx.lineWidth = 1.5;
    drawRoundRect(ctx, cx, cy - bh / 2, bw, bh, br); ctx.stroke();
    // Inner glow shadow
    ctx.shadowColor = accent + "88";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    drawRoundRect(ctx, cx, cy - bh / 2, bw, bh, br); ctx.fill();
    clrShadow();
  };

  // Helper: draw app name pill
  const drawAppNamePill = (x: number, y: number) => {
    ctx.font = `700 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
    const tw = ctx.measureText(appName).width;
    const pillPad = nameSize * 0.5;
    const pillW = tw + pillPad * 2;
    const pillH = nameSize * 1.6;
    const pillR = pillH / 2;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    drawRoundRect(ctx, x, y - pillH / 2, pillW, pillH, pillR); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1;
    drawRoundRect(ctx, x, y - pillH / 2, pillW, pillH, pillR); ctx.stroke();
    ctx.fillStyle = "white"; setShadow();
    ctx.fillText(appName, x + pillPad, y);
    clrShadow();
    return pillW;
  };

  if (isWide) {
    let tx = pad;
    if (appName) {
      const pillW = drawAppNamePill(tx, h / 2);
      tx += pillW + 16;
    }
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.letterSpacing = "0.5px";
    ctx.fillStyle = "white"; setShadow();
    ctx.fillText(headline.slice(0, 50), tx, h / 2);
    ctx.letterSpacing = "0px";
    clrShadow();
    const ctaX = w - ctaW - pad;
    drawCtaButton(ctaX, h / 2, ctaW, ctaH, ctaR);
    ctx.font = `700 ${ctaSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.fillText(cta, ctaX + ctaW / 2, h / 2);
    ctx.textAlign = "left";
  } else {
    // Calculate content height to stack elements without overlap
    const maxTW = w - pad * 2;
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    const words = headline.split(" ");
    let line = "", hlLines: string[] = [];
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxTW && line) { hlLines.push(line); line = word; } else line = test;
    }
    if (line) hlLines.push(line);
    const maxLines = isTall ? 3 : 2;
    hlLines = hlLines.slice(0, maxLines);

    const showSub = !isTiny && sub && h > 150;
    const showBadge = (brief.app_store_url || brief.play_store_url) && h > 200 && !isTiny;
    const showAppName = !isTiny && !!appName;

    // Measure total content block height
    const hlBlockH = hlLines.length * hlSize * 1.3;
    const subBlockH = showSub ? subSize * 1.5 + 8 : 0;
    const badgeBlockH = showBadge ? 28 : 0;
    const ctaBlockH = ctaH + 8;
    const gap = Math.max(6, h * 0.02);
    const totalH = hlBlockH + (showSub ? gap + subBlockH : 0) + (showBadge ? gap + badgeBlockH : 0) + gap + ctaBlockH;

    // Start Y: center the block vertically, leaving room for app name pill at top
    const topReserve = showAppName ? pad + nameSize * 1.6 + gap : pad;
    const startY = Math.max(topReserve, (h - totalH) / 2);

    // Draw app name pill
    if (showAppName) {
      drawAppNamePill(pad, pad + nameSize * 0.8);
    }

    // Draw headline
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.letterSpacing = "0.5px";
    ctx.fillStyle = "white"; setShadow();
    hlLines.forEach((l, i) => ctx.fillText(l, pad, startY + hlSize * 0.5 + i * hlSize * 1.3));
    ctx.letterSpacing = "0px";

    let cursorY = startY + hlBlockH;

    // Draw subheadline
    if (showSub) {
      cursorY += gap;
      const lineY = cursorY + subSize * 0.3;
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, lineY); ctx.lineTo(pad + Math.min(40, w * 0.15), lineY); ctx.stroke();
      cursorY += subSize * 0.8;
      ctx.font = `400 ${subSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = "#D4D4D8"; setShadow();
      // Truncate subheadline to fit width
      let subText = sub;
      while (ctx.measureText(subText).width > maxTW && subText.length > 0) subText = subText.slice(0, -1);
      ctx.fillText(subText, pad, cursorY);
      cursorY += subSize * 0.7;
    }
    clrShadow();

    // Draw store badges
    if (showBadge) {
      cursorY += gap;
      let bx = pad;
      const drawBadge = (l1: string, l2: string) => {
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        drawRoundRect(ctx, bx, cursorY, 100, 22, 4); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1;
        drawRoundRect(ctx, bx, cursorY, 100, 22, 4); ctx.stroke();
        ctx.font = `400 7px "${fontFamily}", Arial`; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
        ctx.fillText(l1, bx + 50, cursorY + 8);
        ctx.font = `700 9px "${fontFamily}", Arial`; ctx.fillStyle = "white";
        ctx.fillText(l2, bx + 50, cursorY + 17);
        ctx.textAlign = "left"; bx += 108;
      };
      if (brief.app_store_url) drawBadge("Download on the", "App Store");
      if (brief.play_store_url) drawBadge("GET IT ON", "Google Play");
      cursorY += 22;
    }

    // Draw CTA button
    cursorY += gap;
    const ctaCy = Math.min(cursorY + ctaH / 2, h - pad - ctaH / 2);
    drawCtaButton(w / 2 - ctaW / 2, ctaCy, ctaW, ctaH, ctaR);
    ctx.font = `700 ${ctaSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.fillText(cta, w / 2, ctaCy);
    ctx.textAlign = "left";
  }

  // Border: outer stroke + inner glow
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.strokeStyle = "rgba(255,255,255,0.20)"; ctx.lineWidth = 2;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

  return canvas.toDataURL("image/png");
}

export async function generateAllBanners(brief: Brief, bgDataUrl: string | null): Promise<GeneratedBanner[]> {
  // Load font first
  const fontFamily = await ensureFontsLoaded();

  let bgImg: HTMLImageElement | null = null;
  if (bgDataUrl) {
    try { bgImg = await loadImage(bgDataUrl); } catch { /* ignore */ }
  }

  const results: GeneratedBanner[] = [];
  for (const size of AD_SIZES) {
    const dataUrl = await renderBanner(size, brief, bgImg, fontFamily);
    results.push({ key: size.key, width: size.width, height: size.height, label: size.label, isTop5: size.isTop5, dataUrl });
  }
  return results;
}
