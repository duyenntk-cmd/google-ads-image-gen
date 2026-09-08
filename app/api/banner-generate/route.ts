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
- App icon (circular, top-left area)
- Illustrated 3D character or mascot relevant to the app (friendly, modern style)
- Smartphone mockup showing the app's UI/interface
- Bold headline: "${brief.headline}"
- Supporting text: "${brief.subheadline || ""}"
- CTA button with text: "${brief.cta_text}" (rounded, prominent)
- Google Play / App Store badge at bottom
Color scheme: primary ${brief.primary_color}, accent ${brief.accent_color}, use white for text on dark backgrounds
Visual style: ${moodMap[brief.mood] || brief.mood}, premium advertising quality
${userPrompt ? `Creative direction: ${userPrompt}` : ""}
Output requirements: photorealistic smartphone mockup, crisp readable text, professional ad agency quality, fills entire canvas, no watermarks, no borders, no lorem ipsum text.`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const { brief, userPrompt, quality = "medium" } = await req.json() as {
      brief: Brief;
      userPrompt?: string;
      quality?: "low" | "medium" | "high" | "auto";
    };

    if (!brief?.app_name) {
      return NextResponse.json({ success: false, error: "Missing brief" }, { status: 400 });
    }

    // Generate 3 base images sequentially to avoid rate limits (gpt-image-1 is slow)
    const images: { key: string; label: string; dataUrl: string }[] = [];
    const errors: string[] = [];

    for (const sz of SIZES) {
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
