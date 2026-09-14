import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { GEN_SIZES, RatioKey } from "@/lib/adSizes";

export const runtime = "nodejs";
// gpt-image-1 is slow (~40-80s/image with references). Requires Vercel Pro for >60s; see README.
export const maxDuration = 300;

const MOOD_STYLES: Record<string, string> = {
  bold: "bold high-contrast, deep shadows, electric energy, cinematic lighting",
  lifestyle: "warm aspirational lifestyle, soft golden-hour light, premium brand feel",
  minimal: "ultra-clean minimalist, generous whitespace, refined",
  product: "sharp product showcase, crisp studio lighting, feature-focused",
  playful: "fun vibrant, bright cheerful colors, rounded shapes, friendly",
  professional: "sophisticated, authoritative palette, premium business",
};

const NICHE_VISUALS: Record<string, string> = {
  photo: "colorful bokeh, soft glows, creative energy",
  tool: "clean modern tech atmosphere, subtle glow",
  office: "professional airy workspace atmosphere",
  game: "playful particle effects, energetic mood",
  health: "wellness glow, soft greens and blues",
  finance: "premium wealth aesthetic, subtle gold accents",
  social: "vibrant friendly connected energy",
  travel: "dreamy wanderlust light, airy",
  education: "friendly bright learning atmosphere",
};

// Reserved-zone + hero layout per ratio. AI renders NO text.
const COMPOSITION: Record<RatioKey, string> = {
  portrait: `PORTRAIT 9:16:
- HERO: the character mascot large in the CENTER-UPPER area, cheerful, holding a smartphone.
- Place a photorealistic 3D phone mockup showing the app UI beside/behind the character.
- TOP 12%: clean simple gradient (reserved for a logo).
- BOTTOM 38%: clean simple gradient, NO objects (reserved for text + a button).`,
  square: `SQUARE 1:1:
- HERO: the character mascot on the RIGHT side, cheerful, holding a smartphone.
- Place a photorealistic 3D phone mockup showing the app UI on the right behind the character.
- TOP-LEFT + BOTTOM: clean simple gradient, NO objects (reserved for logo + text + button).`,
  landscape: `LANDSCAPE 16:9:
- HERO: the character mascot in the CENTER, cheerful, pointing up, holding a smartphone.
- Place a photorealistic 3D phone mockup showing the app UI on the RIGHT.
- TOP-LEFT corner and the BOTTOM band: clean simple gradient, NO objects (reserved for logo + text + button).`,
};

function buildPrompt(
  brief: any,
  userPrompt: string,
  ratioKey: RatioKey,
  hasCharacter: boolean,
  hasScreenshot: boolean,
): string {
  const moodStyle = MOOD_STYLES[brief?.mood] || MOOD_STYLES.playful;
  const nicheVisual = NICHE_VISUALS[brief?.niche] || "";
  const primary = brief?.primary_color || "#7B2FBE";
  const secondary = brief?.secondary_color || "#1A1A2E";
  const accent = brief?.accent_color || "#FF6B35";

  const heroLine = hasCharacter
    ? `HERO CHARACTER: use the CHARACTER in the provided reference image as a polished 3D cartoon mascot. Keep her/his identity, outfit colors and style recognizable and consistent. Friendly, expressive, engaging pose.`
    : `HERO CHARACTER: a friendly, expressive 3D cartoon mascot (Pixar-style), engaging pose, holding a smartphone.`;

  const screenLine = hasScreenshot
    ? `PHONE UI: on the phone screen, show the app interface from the provided app-screenshot reference — keep the real UI recognizable, do not invent a fake UI.`
    : `PHONE UI: show a sleek clean app interface on the phone screen.`;

  return `You are a world-class mobile-app advertising art director.

App: "${brief?.app_name || ""}"
Mood: ${moodStyle}
Atmosphere: ${nicheVisual}
Client brief: ${userPrompt || "(none)"}

${heroLine}
${screenLine}

Add 2-3 small rounded chat/speech chips floating near the character, EACH showing only a single tiny country-flag icon (NO text inside them).

COMPOSITION:
${COMPOSITION[ratioKey]}

STYLE:
- Bright, premium, high-end mobile game / app launch ad quality.
- Soft studio gradient background built from ${primary} and ${secondary}, with ${accent} highlights.
- Cinematic soft lighting, glossy 3D, clean and uncluttered.

ABSOLUTELY STRICT:
- Render NO text, NO letters, NO words, NO numbers, NO captions, NO logos, NO app-store badges anywhere. 100% text-free.
- Keep the reserved zones (top / left / bottom as specified) clean and simple — NO objects there.
- No watermarks, no borders. Fill the canvas edge to edge.`;
}

async function dataUrlToFile(dataUrl: string, name: string) {
  const b64 = dataUrl.split(",")[1] || "";
  const buf = Buffer.from(b64, "base64");
  return toFile(buf, name, { type: "image/png" });
}

export async function POST(req: NextRequest) {
  try {
    const { brief, userPrompt, quality, ratioKey, referenceImages, characterImage } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }
    if (!brief) {
      return NextResponse.json({ success: false, error: "Thiếu brief." }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const targets = ratioKey ? GEN_SIZES.filter((s) => s.key === ratioKey) : GEN_SIZES;
    if (!targets.length) {
      return NextResponse.json({ success: false, error: `ratioKey không hợp lệ: ${ratioKey}` }, { status: 400 });
    }

    const q = (["low", "medium", "high"].includes(quality) ? quality : "high") as "low" | "medium" | "high";
    const shots: string[] = Array.isArray(referenceImages) ? referenceImages.filter(Boolean) : [];
    const hasCharacter = typeof characterImage === "string" && characterImage.startsWith("data:");
    const hasScreenshot = shots.length > 0;
    const useEdit = hasCharacter || hasScreenshot;

    // Build the reference file list once (order matters: character first, then screenshot).
    const refFiles: any[] = [];
    if (hasCharacter) refFiles.push(await dataUrlToFile(characterImage, "character.png"));
    if (hasScreenshot) refFiles.push(await dataUrlToFile(shots[0], "screenshot.png"));

    const images = await Promise.all(
      targets.map(async (t) => {
        const prompt = buildPrompt(brief, userPrompt, t.key, hasCharacter, hasScreenshot);
        let b64: string | undefined;

        if (useEdit) {
          const result = await openai.images.edit({
            model: "gpt-image-1",
            image: (refFiles.length === 1 ? refFiles[0] : refFiles) as any,
            prompt,
            size: t.size as any,
            quality: q as any,
            n: 1,
          });
          b64 = result.data?.[0]?.b64_json;
        } else {
          const result = await openai.images.generate({
            model: "gpt-image-1",
            prompt,
            size: t.size as any,
            quality: q as any,
            n: 1,
          });
          b64 = result.data?.[0]?.b64_json;
        }

        if (!b64) throw new Error(`gpt-image-1 không trả ảnh cho ${t.key}.`);
        return { key: t.key, label: t.label, dataUrl: `data:image/png;base64,${b64}` };
      }),
    );

    return NextResponse.json({ success: true, images });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Lỗi banner-generate." },
      { status: 500 },
    );
  }
}
