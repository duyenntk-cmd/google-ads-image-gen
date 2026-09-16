import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { GEN_SIZES, RatioKey, planGenSize, shapeOf, ShapeKey } from "@/lib/adSizes";

export const runtime = "nodejs";
// One image per request. gpt-image-2.5-flare is ~50% faster than 2.0, but a
// high-quality render with references can still take 30-60s. Vercel Pro needed for >60s.
export const maxDuration = 300;

/* Newest first. If the account can't see a model, we fall through to the next.
 * gpt-image-2.5 accepts arbitrary WxH; the 1.x fallback only does 3 fixed sizes. */
const MODEL_CHAIN = ["gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"] as const;
const PRECISE_CHAIN = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"] as const;
const LEGACY_MODELS = new Set(["gpt-image-1"]);

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

/* Layout per final ad shape. Overlay zones are reserved here so the canvas
 * pass (logo / headline / CTA / Play badge) never lands on top of the subject. */
const SHAPE_LAYOUT: Record<ShapeKey, string> = {
  ultrawide: `- Place the character at the LEFT third, full body visible, facing right.
- Place the phone mockup at the RIGHT third.
- Keep the CENTRE horizontal band clean: it is the only part that survives the crop.
- The middle 40% of the width must stay an uncluttered gradient (reserved for the headline).`,
  wide: `- Place the character on the RIGHT half, cheerful, holding the phone.
- Phone mockup beside the character, slightly behind.
- Keep the LEFT 45% and the BOTTOM 30% as clean gradient (reserved for logo, headline, button).`,
  square: `- Place the character on the RIGHT side, cheerful, holding the phone.
- Phone mockup on the right, slightly behind the character.
- Keep the TOP-LEFT corner and the BOTTOM 35% as clean gradient (reserved for logo, headline, button).`,
  tall: `- Place the character in the CENTRE-UPPER area, full body, cheerful, holding the phone.
- Phone mockup beside or behind the character.
- Keep the TOP 12% and the BOTTOM 38% as clean gradient with NO objects (reserved for logo, headline, button).`,
  ultratall: `- Stack the composition vertically: character in the UPPER-CENTRE, phone mockup below.
- Keep everything inside a narrow CENTRED vertical column — the sides get cropped away.
- Keep the TOP 12% and the BOTTOM 34% as clean gradient with NO objects.`,
};

function buildPrompt(
  brief: any,
  userPrompt: string,
  targetW: number,
  targetH: number,
  cropKeep: number,
  hasCharacter: boolean,
  hasScreenshot: boolean,
): string {
  const shape = shapeOf(targetW, targetH);
  const moodStyle = MOOD_STYLES[brief?.mood] || MOOD_STYLES.playful;
  const nicheVisual = NICHE_VISUALS[brief?.niche] || "";
  const primary = brief?.primary_color || "#7B2FBE";
  const secondary = brief?.secondary_color || "#1A1A2E";
  const accent = brief?.accent_color || "#FF6B35";

  const heroLine = hasCharacter
    ? `HERO CHARACTER: reuse the EXACT character from the provided reference image — same face, same hair, same outfit, same colors, same art style. This character appears across a whole ad set, so identity must stay perfectly consistent. Only the pose and framing may change.`
    : `HERO CHARACTER: a friendly, expressive 3D cartoon mascot (Pixar-style), engaging pose, holding a smartphone.`;

  const screenLine = hasScreenshot
    ? `PHONE UI: on the phone screen, show the app interface from the provided app-screenshot reference — keep the real UI recognizable, do not invent a fake UI.`
    : `PHONE UI: show a sleek clean app interface on the phone screen.`;

  // Warn the model when a large part of the frame is thrown away by the crop.
  const cropLine =
    cropKeep < 0.95
      ? `\nCRITICAL CROP: the final ad is ${targetW}x${targetH}. Only the CENTRED ${Math.round(cropKeep * 100)}% ${
          targetW / targetH > 1 ? "horizontal band" : "vertical column"
        } of this image is kept — everything outside it is discarded. Keep the character, the phone and every important element fully inside that safe area. Do not let the character's head or feet drift outside it.`
      : "";

  return `You are a world-class mobile-app advertising art director.
Design ONE advertising background for a ${targetW}x${targetH} Google Ads banner.

App: "${brief?.app_name || ""}"
Mood: ${moodStyle}
Atmosphere: ${nicheVisual}
Client brief: ${userPrompt || "(none)"}

${heroLine}
${screenLine}

Add 2-3 small rounded chat/speech chips floating near the character, EACH showing only a single tiny country-flag icon (NO text inside them).

COMPOSITION for this ${shape} format:
${SHAPE_LAYOUT[shape]}${cropLine}

STYLE:
- Bright, premium, high-end mobile game / app launch ad quality.
- Soft studio gradient background built from ${primary} and ${secondary}, with ${accent} highlights.
- Cinematic soft lighting, glossy 3D, clean and uncluttered.

ABSOLUTELY STRICT:
- Render NO text, NO letters, NO words, NO numbers, NO captions, NO logos, NO app-store badges anywhere. 100% text-free.
- Keep the reserved zones clean and simple — NO objects there.
- No watermarks, no borders. Fill the canvas edge to edge.`;
}

async function dataUrlToFile(dataUrl: string, name: string) {
  const b64 = dataUrl.split(",")[1] || "";
  const buf = Buffer.from(b64, "base64");
  return toFile(buf, name, { type: "image/png" });
}

/** A model the account can't reach should fall through, not abort the whole run. */
function isModelUnavailable(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  const msg = String(err?.message || "").toLowerCase();
  if (status === 404) return true;
  if (status === 403 && (msg.includes("model") || msg.includes("access"))) return true;
  return (
    msg.includes("does not exist") ||
    msg.includes("not found") ||
    msg.includes("unsupported model") ||
    msg.includes("do not have access") ||
    msg.includes("must be verified")
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { brief, userPrompt, quality, referenceImages, characterImage, precise } = body;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }
    if (!brief) {
      return NextResponse.json({ success: false, error: "Thiếu brief." }, { status: 400 });
    }

    // Preferred path: an exact ad size. Legacy path: a ratioKey (3 base images).
    let targetW = Number(body.width);
    let targetH = Number(body.height);
    let sizeKey: string = body.key || "";
    if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) {
      const ratioKey: RatioKey = body.ratioKey || "square";
      const legacy = GEN_SIZES.find((s) => s.key === ratioKey);
      if (!legacy) {
        return NextResponse.json({ success: false, error: `ratioKey không hợp lệ: ${ratioKey}` }, { status: 400 });
      }
      [targetW, targetH] = legacy.size.split("x").map(Number);
      sizeKey = sizeKey || legacy.key;
    }
    sizeKey = sizeKey || `${targetW}x${targetH}`;

    const plan = planGenSize(targetW, targetH);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const q = (["low", "medium", "high", "xhigh"].includes(quality) ? quality : "high") as string;
    const shots: string[] = Array.isArray(referenceImages) ? referenceImages.filter(Boolean) : [];
    const hasCharacter = typeof characterImage === "string" && characterImage.startsWith("data:");
    const hasScreenshot = shots.length > 0;
    const useEdit = hasCharacter || hasScreenshot;

    const refFiles: any[] = [];
    if (hasCharacter) refFiles.push(await dataUrlToFile(characterImage, "character.png"));
    if (hasScreenshot) refFiles.push(await dataUrlToFile(shots[0], "screenshot.png"));

    const prompt = buildPrompt(brief, userPrompt, targetW, targetH, plan.cropKeep, hasCharacter, hasScreenshot);
    const chain = precise ? PRECISE_CHAIN : MODEL_CHAIN;

    let b64: string | undefined;
    let usedModel = "";
    let genSize = plan.size;
    const tried: string[] = [];

    for (const model of chain) {
      // gpt-image-1 predates arbitrary sizes — fall back to its nearest fixed canvas.
      const size = LEGACY_MODELS.has(model)
        ? plan.genRatio >= 1.25
          ? "1536x1024"
          : plan.genRatio <= 0.8
            ? "1024x1536"
            : "1024x1024"
        : plan.size;
      // gpt-image-1 only knows low/medium/high.
      const modelQuality = LEGACY_MODELS.has(model) && q === "xhigh" ? "high" : q;

      try {
        const result = useEdit
          ? await openai.images.edit({
              model,
              image: (refFiles.length === 1 ? refFiles[0] : refFiles) as any,
              prompt,
              size: size as any,
              quality: modelQuality as any,
              n: 1,
            } as any)
          : await openai.images.generate({
              model,
              prompt,
              size: size as any,
              quality: modelQuality as any,
              n: 1,
            } as any);
        b64 = result.data?.[0]?.b64_json;
        if (b64) {
          usedModel = model;
          genSize = size;
          break;
        }
        tried.push(`${model}: không trả ảnh`);
      } catch (e: any) {
        tried.push(`${model}: ${e?.message || e}`);
        if (isModelUnavailable(e)) continue; // try the next model in the chain
        throw e; // a real failure (rate limit, content policy, bad key) — surface it
      }
    }

    if (!b64) {
      return NextResponse.json(
        { success: false, error: `Không gen được ảnh cho ${sizeKey}. ${tried.join(" | ")}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      model: usedModel,
      images: [
        {
          key: sizeKey,
          label: `${targetW}x${targetH}`,
          targetWidth: targetW,
          targetHeight: targetH,
          genSize,
          native: plan.native,
          dataUrl: `data:image/png;base64,${b64}`,
        },
      ],
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Lỗi banner-generate." },
      { status: 500 },
    );
  }
}
