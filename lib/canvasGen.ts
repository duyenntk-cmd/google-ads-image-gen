import { AD_SIZES, AdSize } from "./adSizes";

interface Brief {
  app_name?: string; headline?: string; subheadline?: string; cta_text?: string;
  primary_color?: string; secondary_color?: string; accent_color?: string;
  best_frame_index?: number; niche?: string;
  app_store_url?: string; play_store_url?: string;
  layout_suggestion?: string;
  subject_position?: string;
  text_zone?: string;
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
  // Smart background: blur-fill so subject is never cropped
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, w, h);
  if (bgImg) {
    // Step 1: blurred cover fill as background (fills the whole canvas)
    ctx.save();
    ctx.filter = "blur(18px)";
    ctx.globalAlpha = 0.7;
    const coverScale = Math.max(w / bgImg.width, h / bgImg.height);
    const csw = bgImg.width * coverScale, csh = bgImg.height * coverScale;
    ctx.drawImage(bgImg, (w - csw) / 2, (h - csh) / 2, csw, csh);
    ctx.restore();
    // Darken the blur layer
    ctx.fillStyle = `rgba(${hexToRgb(primary).join(",")},0.45)`;
    ctx.fillRect(0, 0, w, h);

    // Step 2: sharp image with contain scaling — nothing gets cropped
    const containScale = Math.min(w / bgImg.width, h / bgImg.height);
    const sw = bgImg.width * containScale, sh = bgImg.height * containScale;
    // Vertical offset: push image up so subject stays in upper area, text goes bottom
    const textZone = brief.text_zone || "bottom";
    let oy = (h - sh) / 2;
    if (!isTiny) {
      if (textZone === "bottom") oy = Math.max(0, (h - sh) / 2 - sh * 0.08);
      else if (textZone === "top") oy = Math.min(h - sh, (h - sh) / 2 + sh * 0.08);
    }
    ctx.drawImage(bgImg, (w - sw) / 2, oy, sw, sh);
  }

  if (layout === "minimal") {
    // Minimal: light color-tinted overlay to give branded feel while keeping image visible
    if (!isTiny) {
      const [pr, pg, pb] = hexToRgb(primary);
      const overlay = ctx.createLinearGradient(0, 0, w * 0.4, h);
      overlay.addColorStop(0, `rgba(${pr},${pg},${pb},0.72)`);
      overlay.addColorStop(1, `rgba(${pr},${pg},${pb},0.35)`);
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, w, h);
      // Subtle accent circle
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(w * (isWide ? 0.12 : 0.85), h * 0.12, Math.min(w, h) * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, w, h);
    }
  } else if (layout === "bold") {
    // Bold: strong bottom gradient + diagonal accent stripe
    if (!isTiny) {
      const [pr, pg, pb] = hexToRgb(primary);
      const scrim = ctx.createLinearGradient(0, 0, 0, h);
      scrim.addColorStop(0, `rgba(${pr},${pg},${pb},0.3)`);
      scrim.addColorStop(0.5, `rgba(${pr},${pg},${pb},0.7)`);
      scrim.addColorStop(1, `rgba(${pr},${pg},${pb},0.95)`);
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);
      // Diagonal accent stripe
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = accent;
      ctx.beginPath();
      if (isWide) {
        ctx.moveTo(0, 0); ctx.lineTo(w * 0.4, 0); ctx.lineTo(w * 0.25, h); ctx.lineTo(0, h);
      } else {
        ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.35); ctx.lineTo(0, h * 0.52);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, w, h);
    }
  } else {
    // lifestyle / product: cinematic scrim over image
    if (!isTiny) {
      if (layout === "product") {
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

  // ── IMAGE BOUNDS (after contain-scale) ──────────────────────────────────────
  // Used to place text in the unoccupied blurred margin so it never overlaps image
  let imgBoundsX0 = 0, imgBoundsX1 = w, imgBoundsY0 = 0, imgBoundsY1 = h;
  if (bgImg) {
    const cs = Math.min(w / bgImg.width, h / bgImg.height);
    const imgW = bgImg.width * cs, imgH = bgImg.height * cs;
    imgBoundsX0 = (w - imgW) / 2;
    imgBoundsX1 = imgBoundsX0 + imgW;
    imgBoundsY0 = (h - imgH) / 2;
    imgBoundsY1 = imgBoundsY0 + imgH;
  }
  const isPortraitImg = bgImg && bgImg.height > bgImg.width * 1.2;
  const leftMarginW = imgBoundsX0 - pad * 2;   // usable left blur zone width
  const rightMarginW = w - imgBoundsX1 - pad * 2; // usable right blur zone width
  const bottomMarginH = h - imgBoundsY1 - pad; // usable bottom blur zone height

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
    // Smart text placement: use the blurred margin (left or right) when image is portrait
    // so text never overlaps the actual sharp image
    const useLeftMargin = isPortraitImg && leftMarginW > w * 0.22;
    const useRightMargin = isPortraitImg && !useLeftMargin && rightMarginW > w * 0.22;
    let textX: number, textMaxW: number;
    if (useLeftMargin) {
      textX = pad;
      textMaxW = leftMarginW;
      // Stronger scrim on left margin so text is readable
      const [pr, pg, pb] = hexToRgb(primary);
      const marginScrim = ctx.createLinearGradient(0, 0, imgBoundsX0 + pad * 2, 0);
      marginScrim.addColorStop(0, `rgba(${pr},${pg},${pb},0.88)`);
      marginScrim.addColorStop(1, `rgba(${pr},${pg},${pb},0)`);
      ctx.fillStyle = marginScrim;
      ctx.fillRect(0, 0, imgBoundsX0 + pad * 2, h);
    } else if (useRightMargin) {
      textX = Math.round(imgBoundsX1) + pad;
      textMaxW = w - textX - pad;
      const [pr, pg, pb] = hexToRgb(primary);
      const marginScrim = ctx.createLinearGradient(imgBoundsX1 - pad * 2, 0, w, 0);
      marginScrim.addColorStop(0, `rgba(${pr},${pg},${pb},0)`);
      marginScrim.addColorStop(1, `rgba(${pr},${pg},${pb},0.88)`);
      ctx.fillStyle = marginScrim;
      ctx.fillRect(imgBoundsX1 - pad * 2, 0, w, h);
    } else {
      textX = Math.round(w * 0.5);
      textMaxW = w - textX - pad * 1.5;
    }

    const midY = h / 2;

    // Icon or app tag on the opposite side from text
    const iconSide = useLeftMargin ? imgBoundsX1 + pad : pad;
    if (iconImg) {
      drawIcon(iconSide, h / 2, iconSize);
    } else if (appName && !useLeftMargin) {
      drawAppBadge(pad, pad + nameSize);
    }

    const hlLines = wrapText(headline, textMaxW, 2, hlSize);
    const hlBlockH = hlLines.length * hlSize * 1.2;
    const showSub = subline && layout !== "bold";
    const subBlockH = showSub ? subSize * 1.4 : 0;
    const totalH = hlBlockH + (showSub ? 8 : 0) + subBlockH + 12 + ctaH;
    const startY = midY - totalH / 2;

    // Headline
    ctx.font = `800 ${hlSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.fillStyle = "white";
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

    // If there's a usable bottom margin (image doesn't fill to bottom), use it
    // Otherwise keep text at bottom with extra scrim
    const hasBottomMargin = bottomMarginH > totalH + pad;
    if (hasBottomMargin && bgImg) {
      // Draw extra scrim below image for readability
      const [pr, pg, pb] = hexToRgb(primary);
      const scrim = ctx.createLinearGradient(0, imgBoundsY1 - pad * 2, 0, h);
      scrim.addColorStop(0, `rgba(${pr},${pg},${pb},0)`);
      scrim.addColorStop(1, `rgba(${pr},${pg},${pb},0.92)`);
      ctx.fillStyle = scrim;
      ctx.fillRect(0, imgBoundsY1 - pad * 2, w, h - imgBoundsY1 + pad * 2);
    }

    const startY = hasBottomMargin
      ? Math.round(imgBoundsY1) + pad     // text starts just below the image
      : h - bottomPad - totalH;           // text starts from bottom

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
