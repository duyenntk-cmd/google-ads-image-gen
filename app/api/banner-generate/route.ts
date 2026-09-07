import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Brief {
  app_name: string; headline: string; subheadline: string; cta_text: string;
  primary_color: string; secondary_color: string; accent_color: string;
  mood: string; niche: string;
}

const SIZES = [
  { key: "portrait",  w: 1024, h: 1792, dalle: "1024x1792" as const, label: "9:16 Portrait" },
  { key: "square",    w: 1024, h: 1024, dalle: "1024x1024" as const, label: "1:1 Square"   },
  { key: "landscape", w: 1792, h: 1024, dalle: "1792x1024" as const, label: "16:9 Landscape"},
] as const;

function buildDallePrompt(brief: Brief, ratio: "portrait" | "square" | "landscape", userPrompt: string): string {
  const moodMap: Record<string, string> = {
    bold:      "bold, high-contrast, energetic design with strong typography",
    lifestyle: "aspirational, warm lifestyle photography feel",
    minimal:   "clean minimalist design, lots of white space, elegant",
    product:   "product-focused, feature showcase, tech-savvy",
  };
  const moodDesc = moodMap[brief.mood] || "modern professional design";

  const layoutMap: Record<string, string> = {
    portrait:  "vertical 9:16 mobile banner, app screenshot prominently featured in center, headline text at top, CTA button at bottom",
    square:    "square 1:1 social media ad, balanced composition, app visual on right side, text on left",
    landscape: "horizontal 16:9 banner, app mockup on right, headline and CTA on left side",
  };

  return `Create a professional Google Ads banner for a mobile app.
App: ${brief.app_name}
Headline: "${brief.headline}"
Subtext: "${brief.subheadline}"
Call to action: "${brief.cta_text}"
Layout: ${layoutMap[ratio]}
Design style: ${moodDesc}
Color scheme: primary ${brief.primary_color}, accent ${brief.accent_color}
Additional brief: ${userPrompt || "modern, clean, professional mobile app advertisement"}
Requirements: photorealistic app UI mockup on a smartphone, professional advertising design, no watermarks, no lorem ipsum, text must be clearly readable, high production value, looks like a real Google/Meta ad.
Do NOT include any borders, do NOT show the phone frame cut off, make it fill the entire canvas.`;
}

export async function POST(req: NextRequest) {
  try {
    const { brief, userPrompt, quality = "standard" } = await req.json() as {
      brief: Brief;
      userPrompt?: string;
      quality?: "standard" | "hd";
    };

    if (!brief?.app_name) {
      return NextResponse.json({ success: false, error: "Missing brief" }, { status: 400 });
    }

    // Generate 3 base images in parallel
    const results = await Promise.allSettled(
      SIZES.map(async (size) => {
        const prompt = buildDallePrompt(brief, size.key, userPrompt || "");
        const res = await openai.images.generate({
          model: "dall-e-3",
          prompt,
          size: size.dalle,
          quality,
          n: 1,
        });
        const imgUrl = res.data?.[0]?.url;
        if (!imgUrl) throw new Error(`No image URL for ${size.key}`);
        // Fetch and convert to base64 so the client doesn't need to hit OpenAI URLs
        const imgRes = await fetch(imgUrl);
        if (!imgRes.ok) throw new Error(`Failed to fetch image for ${size.key}`);
        const buf = await imgRes.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        const ct = imgRes.headers.get("content-type") || "image/png";
        return { key: size.key, label: size.label, dataUrl: `data:${ct};base64,${b64}` };
      })
    );

    const images: { key: string; label: string; dataUrl: string }[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") images.push(r.value);
      else errors.push(String(r.reason));
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
