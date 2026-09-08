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
  const layoutMap: Record<string, string> = {
    portrait:  "vertical portrait banner (9:16). Smartphone centered, hero character upper right, headline and CTA on left/bottom.",
    square:    "square banner (1:1). Smartphone on right side, illustrated character beside it, bold headline and CTA button on left.",
    landscape: "horizontal landscape banner (16:9). Smartphone mockup with app UI on the right. Illustrated AI character, bold headline text, and CTA button on the left side.",
  };

  const moodMap: Record<string, string> = {
    bold:      "bold, high-energy, strong contrast",
    lifestyle: "warm, aspirational, lifestyle feel",
    minimal:   "clean, minimal, elegant, lots of whitespace",
    product:   "product showcase, feature-focused, tech-savvy",
  };

  return `Create a professional Google App Campaign advertisement banner.
App name: "${brief.app_name}"
Layout: ${layoutMap[ratio]}
Design elements to include:
- Illustrated 3D character or mascot relevant to the app (friendly, modern style, prominent)
- Smartphone mockup showing the app's UI/interface
- Bold headline text: "${brief.headline}"
- Supporting subtext: "${brief.subheadline || ""}"
- Rounded CTA button with text: "${brief.cta_text}" (prominent, high contrast)
- Google Play badge at the bottom
Color scheme: primary ${brief.primary_color}, accent ${brief.accent_color}, white text on dark areas
Visual style: ${moodMap[brief.mood] || brief.mood}, premium ad agency quality
${userPrompt ? `Creative direction: ${userPrompt}` : ""}
STRICT: Do NOT include any app icon, logo, circle badge, or brand mark anywhere in the image. No icons at all. Leave top 8% of canvas as a plain dark/colored strip for branding overlay.
Output: fills entire canvas, crisp legible text, no watermarks, no lorem ipsum, no borders.`.trim();
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
