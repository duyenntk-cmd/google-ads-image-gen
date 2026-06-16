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
  return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
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

  // Overlay
  const ov = ctx.createLinearGradient(0, 0, 0, h);
  ov.addColorStop(0, "rgba(0,0,0,0)");
  ov.addColorStop(0.45, primary + "99");
  ov.addColorStop(1, primary + "f0");
  ctx.fillStyle = ov;
  ctx.fillRect(0, 0, w, h);

  const setShadow = () => { ctx.shadowColor = "rgba(0,0,0,0.95)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1; };
  const clrShadow = () => { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  const hlSize   = isWide ? Math.max(9, Math.round(h / 3.2))    : isTall ? Math.max(13, Math.round(w * 0.095)) : Math.max(10, Math.round(h * 0.105));
  const subSize  = Math.max(8,  Math.round(hlSize * 0.65));
  const nameSize = Math.max(9,  Math.round(hlSize * 0.7));
  const ctaSize  = Math.max(9,  Math.min(18, Math.round(hlSize * 0.85)));
  const ctaW     = Math.min(Math.round(w * (isWide ? 0.18 : 0.65)), 180);
  const ctaH     = Math.max(22, Math.min(38, Math.round(h * (isTall ? 0.07 : 0.14))));
  const ctaR     = ctaH / 2.5;

  ctx.textBaseline = "middle";

  if (isWide) {
    let tx = pad;
    if (appName) {
      ctx.font = `700 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = "white"; setShadow();
      ctx.fillText(appName, tx, h / 2);
      tx += ctx.measureText(appName).width + 20;
    }
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white"; setShadow();
    ctx.fillText(headline.slice(0, 50), tx, h / 2);
    clrShadow();
    const ctaX = w - ctaW - pad;
    ctx.fillStyle = accent;
    drawRoundRect(ctx, ctaX, (h - ctaH) / 2, ctaW, ctaH, ctaR); ctx.fill();
    ctx.font = `700 ${ctaSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.fillText(cta, ctaX + ctaW / 2, h / 2);
    ctx.textAlign = "left";
  } else {
    if (!isTiny && appName) {
      ctx.font = `700 ${nameSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = "white"; setShadow();
      ctx.fillText(appName, pad, pad + nameSize / 2);
    }
    const hlY = isTall ? h * 0.56 : h * 0.54;
    ctx.font = `700 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white"; setShadow();
    const maxTW = w - pad * 2;
    const words = headline.split(" ");
    let line = "", lines: string[] = [];
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxTW && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    lines.slice(0, isTall ? 3 : 2).forEach((l, i) => ctx.fillText(l, pad, hlY + i * hlSize * 1.25));

    if (!isTiny && sub && h > 150) {
      ctx.font = `400 ${subSize}px "${fontFamily}", Arial, sans-serif`;
      ctx.fillStyle = "#D4D4D8"; setShadow();
      ctx.fillText(sub, pad, isTall ? h * 0.72 : h * 0.73);
    }
    clrShadow();

    if ((brief.app_store_url || brief.play_store_url) && h > 200 && !isTiny) {
      const badgeY = isTall ? h * 0.80 : h * 0.82;
      let bx = pad;
      const drawBadge = (l1: string, l2: string) => {
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        drawRoundRect(ctx, bx, badgeY, 100, 22, 4); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1;
        drawRoundRect(ctx, bx, badgeY, 100, 22, 4); ctx.stroke();
        ctx.font = `400 7px "${fontFamily}", Arial`; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
        ctx.fillText(l1, bx + 50, badgeY + 8);
        ctx.font = `700 9px "${fontFamily}", Arial`; ctx.fillStyle = "white";
        ctx.fillText(l2, bx + 50, badgeY + 17);
        ctx.textAlign = "left"; bx += 108;
      };
      if (brief.app_store_url) drawBadge("Download on the", "App Store");
      if (brief.play_store_url) drawBadge("GET IT ON", "Google Play");
    }

    const ctaCy = isTall ? h * 0.90 : h * 0.91;
    ctx.fillStyle = accent;
    drawRoundRect(ctx, w / 2 - ctaW / 2, ctaCy - ctaH / 2, ctaW, ctaH, ctaR); ctx.fill();
    ctx.font = `700 ${ctaSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.fillText(cta, w / 2, ctaCy);
    ctx.textAlign = "left";
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

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
