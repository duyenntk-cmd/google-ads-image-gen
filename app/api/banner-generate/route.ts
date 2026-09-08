import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Brief {
  app_name: string; headline: string; subheadline: string; cta_text: string;
  primary_color: string; secondary_color: string; accent_color: string;
  mood: string; niche: string;
}

// gpt-image-1 supported sizes
const SIZES = [
  { key: "portrait",  size: "1024x1536" as const, label: "9:16 Portrait"  },
  { key: "square",    size: "1024x1024" as const, label: "1:1 Square"     },
  { key: "landscape", size: "1536x1024" as const, label: "16:9 Landscape" },
] as const;

function buildPrompt(brief: Brief, ratio: "portrait" | "square" | "landscape", userPrompt: string): string {

  const moodStyle: Record<string, string> = {
    bold:         "bold high-contrast design with deep shadows and vivid pop colors, electric energy, cinematic lighting",
    lifestyle:    "warm aspirational lifestyle feel, soft golden-hour lighting, premium brand aesthetic",
    minimal:      "ultra-clean minimalist design, generous whitespace, refined typography, subtle gradients",
    product:      "sharp product showcase style, crisp tech aesthetics, clean studio lighting, feature-focused layout",
    playful:      "fun vibrant illustration style, bright cheerful colors, rounded shapes, friendly characters",
    professional: "sophisticated corporate design, authoritative color palette, premium business aesthetic",
  };

  const nicheVisual: Record<string, string> = {
    photo:    "camera lens flare effects, colorful bokeh, a glowing phone screen showing a stunning edited photo",
    tool:     "productivity dashboard interface on phone screen, task completion checkmarks, efficiency icons",
    office:   "clean document/spreadsheet UI on phone screen, professional workspace aesthetic",
    game:     "game character render, particle effects, epic fantasy/action visual style",
    health:   "wellness lifestyle imagery, soft greens and blues, healthy glow lighting",
    finance:  "rising chart/graph elements, gold accent details, wealth and success aesthetic",
    social:   "connected people, chat bubbles, vibrant social interactions on phone screen",
    travel:   "stunning destination photography, wanderlust mood, travel adventure aesthetic",
  };

  const style = moodStyle[brief.mood] || moodStyle.bold;
  const visual = nicheVisual[brief.niche] || "";

  // Layout-specific composition instructions
  const compositions: Record<string, string> = {
    portrait: `
CANVAS: Full-bleed vertical 9:16 format, fills every pixel edge-to-edge.
BACKGROUND: Rich deep gradient from ${brief.primary_color} at top to a darker tone at bottom, with subtle diagonal light rays or bokeh particles for depth. ${visual}
TOP ZONE (top 10% of canvas): Flat solid dark strip — leave completely empty, no text, no graphics, plain color (this zone is reserved for app icon overlay).
UPPER SECTION (10-50% of canvas): Centered hero visual — a beautifully rendered 3D smartphone mockup tilted at a slight angle showing the app UI on screen. The phone has a soft drop shadow and a rim light glow. Behind the phone, large abstract geometric shapes or glowing orbs in ${brief.accent_color} add depth.
CHARACTER: A friendly 3D-rendered mascot or abstract 3D icon element floats near the upper-right corner of the phone, catching the light.
LOWER SECTION (50-85% of canvas):
  - Headline text: "${brief.headline}" — Very large, bold, white text, 2-3 lines maximum, centered with tight line spacing. Use a modern sans-serif weight.
  - Subheadline: "${brief.subheadline}" — Smaller, lighter weight, soft white/80% opacity, centered below headline.
BOTTOM ZONE (85-100%): A prominent pill-shaped CTA button with text "${brief.cta_text}", filled with ${brief.accent_color}, white bold text, centered. Below it a very small Google Play badge in white.`,

    square: `
CANVAS: Perfect square 1:1 format, fills every pixel edge-to-edge.
BACKGROUND: Dynamic split-design background — left half is a rich gradient in ${brief.primary_color} tones, right half slightly lighter with a large glowing orb or bokeh effect. ${visual}
TOP ZONE (top 10% of canvas): Flat solid dark strip — leave completely empty, no text, no graphics (reserved for app icon overlay).
LEFT SIDE (10-90% height, left 45% width):
  - Headline: "${brief.headline}" — Large bold white text, 2-3 lines, left-aligned. Strong typographic hierarchy.
  - Subheadline: "${brief.subheadline}" — Smaller, muted white, left-aligned.
  - CTA button: Pill-shaped button with "${brief.cta_text}" text, ${brief.accent_color} fill, white text, left-aligned.
RIGHT SIDE (10-90% height, right 55% width):
  - Large 3D smartphone mockup (slightly angled, front-facing) showing the app UI. The phone occupies most of this zone vertically. Soft shadow beneath it.
  - Glowing accent shapes in ${brief.accent_color} behind the phone for visual pop.
BOTTOM: Google Play micro-badge, bottom-center.`,

    landscape: `
CANVAS: Full-bleed horizontal 16:9 format, fills every pixel edge-to-edge.
BACKGROUND: Immersive gradient background — darker on left, gradually brightening toward right — in the ${brief.primary_color} color family. Subtle light sweep or particle effects for premium feel. ${visual}
TOP ZONE (top 10% of canvas): Flat solid dark strip — leave completely empty (reserved for app icon overlay).
LEFT SECTION (10-100% height, left 50% width):
  - Large headline: "${brief.headline}" — Extra-bold white text, 2-3 lines, left-aligned, vertically centered in left half.
  - Subheadline: "${brief.subheadline}" — Smaller, lighter, left-aligned below headline.
  - CTA button: Large pill shape with "${brief.cta_text}", filled ${brief.accent_color}, white text. Left-aligned below subheadline.
  - Small Google Play badge below CTA.
RIGHT SECTION (10-100% height, right 50% width):
  - Hero 3D smartphone mockup: Large, front-facing, slightly angled left. Screen shows the app's clean UI. Phone has realistic glass sheen, drop shadow, and ${brief.accent_color} rim light glow.
  - A 3D character or floating abstract shapes orbit near the phone, adding dynamism.
  - Decorative ${brief.accent_color} glowing circle or arc behind the phone for depth.`,
  };

  return `You are a world-class digital ad creative designer at a top-tier agency. Create a stunning, award-worthy Google App Campaign banner image.

App: "${brief.app_name}"
Design mood: ${style}
${userPrompt ? `Client brief: ${userPrompt}` : ""}

COMPOSITION SPEC:
${compositions[ratio]}

DESIGN QUALITY REQUIREMENTS:
- Premium ad agency quality — think Apple, Spotify, or top mobile game launch ads
- Photorealistic 3D phone mockup with accurate screen reflection and glass sheen
- Rich color depth: use the full ${brief.primary_color} → ${brief.accent_color} palette with smooth gradients
- Cinematic lighting: volumetric light rays, soft glows, realistic shadows and highlights
- Typography is crisp, modern, perfectly kerned — text must be 100% legible at small sizes
- Every element has intentional visual hierarchy — eye flows naturally from hero image → headline → CTA
- Background is rich and layered, NOT flat or boring

STRICT RULES:
- Top 10% of canvas: EMPTY flat dark strip only — NO text, NO icons, NO graphics whatsoever
- NO app store icons, NO round badge icons, NO brand logos of any kind
- NO watermarks, NO borders, NO lorem ipsum, NO placeholder text
- Fills 100% of canvas edge to edge with no padding or whitespace at edges
- All text must be clearly readable — no text lost in background`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const { brief, userPrompt, quality = "medium", ratioKey } = await req.json() as {
      brief: Brief;
      userPrompt?: string;
      quality?: "low" | "medium" | "high" | "auto";
      ratioKey?: string; // optional: generate only 1 ratio (called 3x from client to avoid timeout)
    };

    if (!brief?.app_name) {
      return NextResponse.json({ success: false, error: "Missing brief" }, { status: 400 });
    }

    const sizesToGen = ratioKey ? SIZES.filter(s => s.key === ratioKey) : SIZES;

    const images: { key: string; label: string; dataUrl: string }[] = [];
    const errors: string[] = [];

    for (const sz of sizesToGen) {
      try {
        const prompt = buildPrompt(brief, sz.key, userPrompt || "");
        const res = await openai.images.generate({
          model: "gpt-image-1",
          prompt,
          size: sz.size,
          quality,
          n: 1,
        });
        const b64 = res.data?.[0]?.b64_json;
        if (b64) {
          images.push({ key: sz.key, label: sz.label, dataUrl: `data:image/png;base64,${b64}` });
          continue;
        }
        const imgUrl = res.data?.[0]?.url;
        if (!imgUrl) throw new Error(`No image returned for ${sz.key}`);
        const imgRes = await fetch(imgUrl);
        if (!imgRes.ok) throw new Error(`Failed to fetch image for ${sz.key}`);
        const buf = await imgRes.arrayBuffer();
        const b64url = Buffer.from(buf).toString("base64");
        images.push({ key: sz.key, label: sz.label, dataUrl: `data:image/png;base64,${b64url}` });
      } catch (e) {
        errors.push(String(e));
      }
    }

    if (images.length === 0) {
      return NextResponse.json({ success: false, error: errors.join("; ") }, { status: 500 });
    }

    return NextResponse.json({ success: true, images, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error("Banner generate error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
