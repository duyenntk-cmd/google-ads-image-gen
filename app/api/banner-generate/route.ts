import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { planGenSize, shapeOf, ShapeKey } from "@/lib/adFormats";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
// One image per request so 20 sizes fan out across 20 invocations instead of
// serialising inside one. A high-quality render with references still takes
// 30-60s, which needs Vercel Pro to exceed the 60s default.
export const maxDuration = 300;

/* Newest first; if the account cannot see a model we fall through to the next.
 * gpt-image-2.5 accepts an arbitrary WxH — the 1.x fallback only has 3 sizes. */
const MODEL_CHAIN = ["gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"];
const PRECISE_CHAIN = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"];
const FIXED_SIZE_MODELS = new Set(["gpt-image-1"]);

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

/* Layout per final ad shape. The overlay zones are reserved here so the canvas
 * pass (logo / headline / CTA / Play badge) never lands on the subject. */
const SHAPE_LAYOUT: Record<ShapeKey, string> = {
  wide: `- Compose for a wide 1.91:1 frame: character on one side, phone mockup on the other.
- Keep the BOTTOM 30% and one upper corner as clean gradient (reserved for logo, headline, button).`,
  square: `- Compose for a 1:1 frame: character slightly off-centre, phone mockup beside or behind.
- Keep the TOP-LEFT corner and the BOTTOM 35% as clean gradient (reserved for logo, headline, button).`,
  tall: `- Compose for a tall 4:5 frame: character full body in the upper-centre, phone mockup beside or below.
- Keep the TOP 12% and the BOTTOM 34% as clean gradient with NO objects (reserved for logo, headline, button).`,
};

function buildPrompt(
  brief: Record<string, unknown> | null,
  userPrompt: string,
  targetW: number,
  targetH: number,
  cropKeep: number,
  hasCharacter: boolean,
  hasScreenshot: boolean,
  angle: string,
): string {
  const b = (brief || {}) as Record<string, string>;
  const shape = shapeOf(targetW, targetH);
  const moodStyle = MOOD_STYLES[b.mood] || MOOD_STYLES.playful;
  const nicheVisual = NICHE_VISUALS[b.niche] || "";
  const primary = b.primary_color || "#7B2FBE";
  const secondary = b.secondary_color || "#1A1A2E";
  const accent = b.accent_color || "#FF6B35";

  const heroLine = hasCharacter
    ? `HERO CHARACTER: reuse the EXACT character from the provided reference image — same face, same hair, same outfit, same colors, same art style. This character appears across a whole ad set, so identity must stay perfectly consistent. Only the pose and framing may change.`
    : `HERO CHARACTER: a friendly, expressive 3D cartoon mascot (Pixar-style), engaging pose, holding a smartphone.`;

  const screenLine = hasScreenshot
    ? `PHONE UI: on the phone screen, show the app interface from the provided app-screenshot reference — keep the real UI recognizable, do not invent a fake UI.`
    : `PHONE UI: show a sleek clean app interface on the phone screen.`;

  // Warn the model when the crop throws away a large part of the frame.
  const cropLine =
    cropKeep < 0.95
      ? `\nCRITICAL CROP: the final ad is ${targetW}x${targetH}. Only the CENTRED ${Math.round(cropKeep * 100)}% ${
          targetW / targetH > 1 ? "horizontal band" : "vertical column"
        } of this image is kept — everything outside it is discarded. Keep the character, the phone and every important element fully inside that safe area. Do not let the character's head or feet drift outside it.`
      : "";

  return `You are a world-class mobile-app advertising art director.
Design ONE advertising background for a ${targetW}x${targetH} Google Ads banner.

App: "${b.app_name || ""}"
Mood: ${moodStyle}
Atmosphere: ${nicheVisual}
Client brief: ${userPrompt || "(none)"}

CREATIVE ANGLE for this specific asset — this is what makes it differ from the
others in the set, so commit to it rather than falling back on a generic layout:
${angle || "Classic hero shot of the mascot with the phone."}

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
  return toFile(Buffer.from(b64, "base64"), name, { type: "image/png" });
}

/** A model the account cannot reach should fall through, not abort the run. */
function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number }; message?: string };
  const status = e?.status ?? e?.response?.status;
  const msg = String(e?.message || "").toLowerCase();
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
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const body = await req.json();
    const { brief, userPrompt, quality, referenceImages, characterImage, precise, angle } = body;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }
    if (!brief) {
      return NextResponse.json({ success: false, error: "Thiếu brief." }, { status: 400 });
    }

    const targetW = Number(body.width);
    const targetH = Number(body.height);
    if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) {
      return NextResponse.json({ success: false, error: "Thiếu width/height hợp lệ." }, { status: 400 });
    }
    const sizeKey: string = body.key || `${targetW}x${targetH}`;

    const plan = planGenSize(targetW, targetH);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const q = (["low", "medium", "high"].includes(quality) ? quality : "high") as "low" | "medium" | "high";
    const shots: string[] = Array.isArray(referenceImages) ? referenceImages.filter(Boolean) : [];
    const hasCharacter = typeof characterImage === "string" && characterImage.startsWith("data:");
    const hasScreenshot = shots.length > 0;
    const useEdit = hasCharacter || hasScreenshot;

    // Order matters: the character reference goes first so the model treats it
    // as the subject rather than as scenery.
    const refFiles = [];
    if (hasCharacter) refFiles.push(await dataUrlToFile(characterImage, "character.png"));
    if (hasScreenshot) refFiles.push(await dataUrlToFile(shots[0], "screenshot.png"));

    const prompt = buildPrompt(brief, userPrompt, targetW, targetH, plan.cropKeep, hasCharacter, hasScreenshot, typeof angle === "string" ? angle : "");
    const chain = precise ? PRECISE_CHAIN : MODEL_CHAIN;

    let b64: string | undefined;
    let usedModel = "";
    let genSize = plan.size;
    const tried: string[] = [];

    for (const model of chain) {
      // gpt-image-1 predates arbitrary sizes — fall back to its nearest canvas.
      const size = FIXED_SIZE_MODELS.has(model)
        ? plan.genRatio >= 1.25
          ? "1536x1024"
          : plan.genRatio <= 0.8
            ? "1024x1536"
            : "1024x1024"
        : plan.size;

      try {
        const result = useEdit
          ? await openai.images.edit({
              model,
              image: refFiles.length === 1 ? refFiles[0] : refFiles,
              prompt,
              size,
              quality: q,
              // Holds the reference character's identity across all 20 renders.
              input_fidelity: "high",
              n: 1,
            })
          : await openai.images.generate({ model, prompt, size, quality: q, n: 1 });

        b64 = result.data?.[0]?.b64_json;
        if (b64) {
          usedModel = model;
          genSize = size;
          break;
        }
        tried.push(`${model}: không trả ảnh`);
      } catch (e) {
        tried.push(`${model}: ${(e as Error)?.message || e}`);
        if (isModelUnavailable(e)) continue; // try the next model
        throw e; // real failure (rate limit, content policy, bad key)
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
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error)?.message || "Lỗi banner-generate." },
      { status: 500 },
    );
  }
}
