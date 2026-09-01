import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const IDEOGRAM_API = "https://api.ideogram.ai/generate";

// Map our 3 banner groups to Ideogram aspect ratios
const RATIO_MAP = {
  landscape: "ASPECT_16_9",   // 1200×628 ≈ 16:8.4, closest is 16:9
  square:    "ASPECT_1_1",    // 1200×1200
  portrait:  "ASPECT_9_16",  // 1080×1920
};

interface Brief {
  app_name?: string;
  headline?: string;
  subheadline?: string;
  cta_text?: string;
  primary_color?: string;
  accent_color?: string;
  mood?: string;
  niche?: string;
  layout_suggestion?: string;
}

function buildPrompt(brief: Brief, ratio: "landscape" | "square" | "portrait"): string {
  const appName  = brief.app_name    || "Mobile App";
  const headline = brief.headline    || "Amazing App";
  const sub      = brief.subheadline || "";
  const cta      = brief.cta_text    || "Try Free";
  const primary  = brief.primary_color || "#7B2FBE";
  const accent   = brief.accent_color  || "#FF6B35";
  const mood     = brief.mood          || "bold";
  const niche    = brief.niche         || "photo";
  const layout   = brief.layout_suggestion || "lifestyle";

  const moodDesc: Record<string, string> = {
    bold:         "bold, high-energy, dynamic",
    minimal:      "clean, minimal, modern",
    professional: "professional, trustworthy, corporate",
    playful:      "playful, fun, vibrant",
    vibrant:      "vibrant, colorful, eye-catching",
  };

  const nicheDesc: Record<string, string> = {
    photo:  "photography, creative, visual editing app",
    tool:   "productivity, utility, tools app",
    office: "business, enterprise, office app",
  };

  const layoutDesc: Record<string, string> = {
    lifestyle: "lifestyle scene with people",
    product:   "app UI/product showcase with phone mockup",
    minimal:   "clean minimal design",
    bold:      "bold graphic design",
  };

  const ratioDesc: Record<string, string> = {
    landscape: "horizontal banner",
    square:    "square social media post",
    portrait:  "vertical story/portrait banner",
  };

  return `Google App Campaign advertisement banner, ${ratioDesc[ratio]}, ${moodDesc[mood] || mood} style.
App: "${appName}" — ${nicheDesc[niche] || niche}.
Large bold headline text: "${headline}".
${sub ? `Supporting text: "${sub}".` : ""}
Call-to-action button with text: "${cta}".
Color scheme: dominant color ${primary}, accent color ${accent}.
Visual style: ${layoutDesc[layout] || layout}, ${moodDesc[mood] || mood}.
Professional Google Ads banner design, high contrast, text clearly legible, app advertisement aesthetic.
NO watermarks, NO logos of other brands, NO URLs, NO borders.`.trim();
}

async function generateOne(
  prompt: string,
  ratio: "ASPECT_16_9" | "ASPECT_1_1" | "ASPECT_9_16",
  apiKey: string
): Promise<string> {
  const res = await fetch(IDEOGRAM_API, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_request: {
        prompt,
        aspect_ratio: ratio,
        model: "V_2",
        style_type: "DESIGN",
        negative_prompt: "blurry, low quality, watermark, ugly, deformed, text errors, misspelled",
        num_images: 1,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ideogram API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const imageUrl = data?.data?.[0]?.url;
  if (!imageUrl) throw new Error("Ideogram returned no image URL");

  // Fetch image and convert to base64 so we can serve it without CORS issues
  const imgRes = await fetch(imageUrl);
  const buf = await imgRes.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const ct = imgRes.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${b64}`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "IDEOGRAM_API_KEY chưa được cấu hình trong Vercel env" }, { status: 500 });
  }

  try {
    const { brief } = await req.json() as { brief: Brief };
    if (!brief) return NextResponse.json({ success: false, error: "Missing brief" }, { status: 400 });

    // Generate 3 images in parallel — one per aspect ratio
    const [landscape, square, portrait] = await Promise.all([
      generateOne(buildPrompt(brief, "landscape"), RATIO_MAP.landscape as "ASPECT_16_9", apiKey),
      generateOne(buildPrompt(brief, "square"),    RATIO_MAP.square    as "ASPECT_1_1",  apiKey),
      generateOne(buildPrompt(brief, "portrait"),  RATIO_MAP.portrait  as "ASPECT_9_16", apiKey),
    ]);

    return NextResponse.json({
      success: true,
      images: {
        landscape,  // 16:9 — use for 1200×628
        square,     // 1:1  — use for 1200×1200
        portrait,   // 9:16 — use for 1080×1920
      },
    });
  } catch (err) {
    console.error("Ideogram error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
