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
  bold: "bold and high-contrast, confident, strong shapes",
  lifestyle: "warm aspirational lifestyle, soft natural light, premium brand feel",
  minimal: "ultra-clean minimalist, generous negative space, refined",
  product: "sharp product showcase, crisp studio lighting, feature-focused",
  playful: "fun and vibrant, bright cheerful colours, rounded friendly shapes",
  professional: "sophisticated and authoritative, restrained palette, premium business",
};

/* Background treatment. The old prompt always asked for a dark gradient, which
 * fought the bright, airy look most app-install creative uses. */
const BG_MODES: Record<string, string> = {
  light: "BACKGROUND: bright and airy. Near-white or very light tinted base, with ONE soft sweeping colour shape (a wide curve or blob) in the brand colours behind the subject. Keep it clean and uncluttered — this is a high-key advertising background, not a detailed scene.",
  dark: "BACKGROUND: rich and saturated. Deep gradient built from the brand colours, with a soft radial glow behind the subject to lift it off the background. Keep it clean and uncluttered — no busy detail.",
};

/* Composition per final shape. Reserved zones are stated as percentages because
 * the canvas pass draws the logo, headline, CTA and Play badge into them, and
 * anything the model puts there gets covered. */
/* Composition per final shape.
 *
 * The reserved area is stated FIRST and as an absolute. Listed after the props,
 * it read as an afterthought: "props cluster in the upper-middle" put flashcards
 * across the headline, because the upper middle of a square overlaps the column.
 *
 * The prop count is capped too. Left open, the model kept adding — an icon, two
 * flashcards, a chart, a progress ring, sparkles — until the frame was noise.
 */
const SHAPE_LAYOUT: Record<ShapeKey, string> = {
  wide: `FRAME: wide 1.91:1.
- RESERVED AREA — absolutely nothing may enter it. Not the subject, not the phone,
  not one prop, not a sparkle: the LEFT 45% of the width, and the BOTTOM 26% of
  the height. Plain background only.
- Subject inside the RIGHT 40%, three-quarter or full view, facing slightly left.
- Phone mockup beside the subject, fully inside the right 55%.
- AT MOST 2 supporting props, both inside the right 55%.`,
  square: `FRAME: square 1:1.
- RESERVED AREA — absolutely nothing may enter it. Not the subject, not the phone,
  not one prop, not a sparkle: the LEFT 42% of the width, and the BOTTOM 30% of
  the height. Plain background only.
- Subject inside the RIGHT 45%, three-quarter or full view, facing slightly left.
- Phone mockup beside the subject, fully inside the right 58%.
- AT MOST 3 supporting props, all inside the right 58%, grouped near the top.`,
  tall: `FRAME: tall 4:5.
- RESERVED AREA — absolutely nothing may enter it: the TOP 14% and the BOTTOM 34%
  of the height. Plain background only.
- Subject centred horizontally in the MIDDLE band, full body or waist-up.
- AT MOST 3 supporting props, beside and just above the subject, inside that band.`,
};


function buildPrompt(
  brief: any,
  userPrompt: string,
  targetW: number,
  targetH: number,
  cropKeep: number,
  hasCharacter: boolean,
  hasScreenshot: boolean,
  angle: string,
  platform: string,
  uiLanguage: string,
  revision: string,
  removals: string[],
): string {
  const shape = shapeOf(targetW, targetH);
  const moodStyle = MOOD_STYLES[brief?.mood] || MOOD_STYLES.playful;
  const bgMode = BG_MODES[brief?.bg_mode === "dark" ? "dark" : "light"];
  const primary = brief?.primary_color || "#7B2FBE";
  const secondary = brief?.secondary_color || "#1A1A2E";
  const accent = brief?.accent_color || "#FF6B35";
  const heroSubject = brief?.hero_subject || "a friendly person happily using the app on a smartphone";
  // Props come from the brief so they match THIS app. They used to be hardcoded
  // as flag chips, which only ever made sense for a language-learning app.
  const keyVisual = brief?.key_visual || "soft floating UI cards and gentle sparkles";

  const heroLine = hasCharacter
    ? `HERO: reuse the EXACT character from the provided reference image — same face, same hairstyle, same outfit, same colours, same art style. This character runs across a whole ad set, so identity must stay perfectly consistent; only pose, expression and framing may change. Here: ${heroSubject}.`
    : `HERO: ${heroSubject}. Render as a polished 3D cartoon character (Pixar-like), appealing and expressive.`;

  // Show the hardware the app actually ships on. Left unsaid, the model defaults
  // to an iPhone — wrong for a Play-Store-only app, and a detail the audience
  // notices.
  const device =
    platform === "ios"
      ? "a modern iPhone: rounded corners, a pill-shaped cutout at the top of the screen, polished metal edges"
      : "a modern ANDROID phone: flat or gently curved edges, a small CENTRED hole-punch camera at the top of the screen, slim uniform bezels. NOT an iPhone — no notch, no pill-shaped cutout";
  // Developers often ship one English screenshot set for every market, so the
  // reference can be English even from the right store. The layout is what must
  // be faithful; the labels should read in the language the banner speaks.
  const localise = Boolean(uiLanguage) && !/^english$/i.test(uiLanguage);
  const uiLangLine = "";
  // Given as its own block, not appended to the PHONE line: buried at the end of
  // a long sentence the model kept copying the reference's English labels
  // verbatim. It is repeated in the MUST list below for the same reason.
  const uiLangBlock = localise
    ? `\nSCREEN LANGUAGE — THIS MATTERS:
The reference screenshot may be in English. DO NOT copy its words.
Every word rendered on the phone screen must be written in ${uiLanguage}:
section titles, button labels, tab names, status text. Translate them.
Keep the same layout, icons, colours and arrangement as the reference — only the
words change. Spell them correctly, with every diacritic in place.\n`
    : "";
  // An open palm facing the viewer with fingers spread is where hands go wrong;
  // saying "no malformed hands" does not help, naming the pose does.
  const handsLine =
    "HANDS: keep them simple. Holding the phone, resting relaxed, or one hand in a " +
    "soft closed gesture. Do NOT show an open palm facing the viewer with fingers " +
    "spread apart, and never two open hands at once.";

  const screenLine = hasScreenshot
    ? `PHONE: include a clean 3D mockup of ${device}, showing the app interface from the provided screenshot reference. Keep the real UI layout recognisable — same structure, do not invent a different interface.${uiLangLine} Screen sharp and upright, not tilted away.`
    : `PHONE: include a clean 3D mockup of ${device}, with a simple, plausible app interface on screen.${uiLangLine}`;

  const cropLine =
    cropKeep < 0.95
      ? `\nCROP WARNING: the delivered ad is ${targetW}x${targetH}. Only the CENTRED ${Math.round(cropKeep * 100)}% ${
          targetW / targetH > 1 ? "horizontal band" : "vertical column"
        } survives — everything outside is discarded. Keep the subject and every important element fully inside that safe area.`
      : "";

  // Placed first and framed as a correction. The operator has already seen a
  // render and is asking for a specific change, so this outranks the standing
  // brief wherever the two disagree.
  const revisionBlock = revision?.trim()
    ? `REVISION — the client has seen a previous version and asked for this change.
It takes priority over anything below that contradicts it. Apply it exactly:
${revision.trim()}
Leave everything else as described.

`
    : "";

  // Removals are listed as their own prohibitions as well as being edited out of
  // the description above. A described thing tends to survive a mere "no X", so
  // it has to be absent from the description AND named here.
  const removalLines = (removals || [])
    .filter((r) => r && r.trim())
    .map((r) => `- ${r.trim()}. Do not substitute anything similar in its place — leave that area EMPTY background.`)
    .join("\n");

  return `You are an award-winning art director for mobile app install advertising.
Produce ONE finished advertising background, ${targetW}x${targetH}, for the app "${brief?.app_name || ""}".

${revisionBlock}
${heroLine}
${handsLine}
${screenLine}
${uiLangBlock}
SUPPORTING VISUALS (specific to this app — include these, not generic filler):
${keyVisual}
These are OBJECTS and effects only. They must not include a second character,
mascot, robot or face — one hero, nothing competing with it.

CREATIVE ANGLE for this particular asset — commit to it, this is what makes it
differ from the others in the set:
${angle || "Classic hero shot: the subject front and centre, confident and welcoming."}

ART DIRECTION: ${moodStyle}
${userPrompt ? `CLIENT BRIEF: ${userPrompt}` : ""}

${bgMode}
Brand palette: ${primary} as the dominant colour, ${secondary} as the supporting
tone, ${accent} reserved for small high-energy highlights only.

${SHAPE_LAYOUT[shape]}${cropLine}

RENDER QUALITY:
- Advertising-grade finish: crisp edges, clean silhouettes, believable soft shadows grounding every element.
- Even, flattering light on the subject's face. No harsh shadows across features.
- Subject in sharp focus; background elements may fall off softly.
- Colours vivid but not oversaturated; no muddy greys.

MUST NOT APPEAR — these ruin the asset:
- Any headline, slogan, caption, watermark, brand logo or app-store badge anywhere in the artwork. All ad copy is composited afterwards, so leave the artwork free of it.
  The ONLY exception is the interface INSIDE the phone screen, which is part of the device and may carry its own small UI labels.
- Anything at all inside the RESERVED zones — they get covered by the layout.${removalLines ? `\n${removalLines}` : ""}${localise ? `\n- English words on the phone screen. Every label there must read in ${uiLanguage}.` : ""}
- A SECOND character, mascot, robot or creature. Exactly ONE character in frame — the hero. An app icon shown as a flat badge is fine; a second animated face is not.
- An open palm facing the viewer with spread fingers — the pose fingers come out wrong in.
- Malformed hands, extra or missing fingers, distorted faces, asymmetric eyes, extra limbs.
- More props than the frame calls for. A crowded frame reads as noise; stop at the stated count.
- Borders, frames, drop-shadow edges, collage panels, or a visible canvas edge. Fill the frame completely, edge to edge.
- Cluttered or busy composition. Fewer, better elements.`;
}

async function dataUrlToFile(dataUrl: string, name: string) {
  const b64 = dataUrl.split(",")[1] || "";
  return toFile(Buffer.from(b64, "base64"), name, { type: "image/png" });
}

/**
 * Waits out a rate limit and says how long for.
 *
 * The images endpoint limits *input images per minute* separately, and an edit
 * call sends two references — a mascot and a screenshot — so a 20-image run
 * exhausts a limit of 5 within seconds. OpenAI states the wait in the message
 * ("Please try again in 12s"), so honour it rather than guessing a backoff.
 *
 * Returns null when the error is not a rate limit.
 */
function rateLimitWaitMs(err: unknown): number | null {
  const e = err as { status?: number; message?: string };
  if (e?.status !== 429) return null;
  const m = /try again in ([\d.]+)\s*(ms|s)/i.exec(String(e?.message || ""));
  if (!m) return 15000;
  const n = parseFloat(m[1]);
  // A second of headroom: the window is measured on their clock, not ours.
  return Math.min(60000, (m[2].toLowerCase() === "ms" ? n : n * 1000) + 1000);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Models that rejected input_fidelity, remembered for the life of the instance.
 *
 * input_fidelity: "high" holds a reference character's identity across renders,
 * which is exactly what an ad set needs — but it is not supported on every
 * model. gpt-image-2.5-flare answers 400 "does not support the 'input_fidelity'
 * parameter", and since that is a legitimate 400 rather than a missing model,
 * the fallback chain used to surface it and abandon the whole run.
 *
 * Rather than hardcode which models accept it — a guess that ages badly — try it
 * once, and drop it for that model if it is refused.
 */
const noInputFidelity = new Set<string>();

function rejectsInputFidelity(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return (e?.status === 400 || e?.status === 422) && /input_fidelity/i.test(String(e?.message || ""));
}

async function editWithOptionalFidelity(
  openai: OpenAI,
  model: string,
  refFiles: Awaited<ReturnType<typeof toFile>>[],
  prompt: string,
  size: string,
  quality: "low" | "medium" | "high",
) {
  const base = {
    model,
    image: refFiles.length === 1 ? refFiles[0] : refFiles,
    prompt,
    size,
    quality,
    n: 1,
  };

  if (!noInputFidelity.has(model)) {
    try {
      return await openai.images.edit({ ...base, input_fidelity: "high" });
    } catch (e) {
      if (!rejectsInputFidelity(e)) throw e;
      noInputFidelity.add(model);
      // fall through and retry without it
    }
  }
  return await openai.images.edit(base);
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const body = await req.json();
    const { brief, userPrompt, quality, referenceImages, characterImage, precise, angle, platform, uiLanguage, revision, removals } = body;

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

    const prompt = buildPrompt(brief, userPrompt, targetW, targetH, plan.cropKeep, hasCharacter, hasScreenshot, typeof angle === "string" ? angle : "", platform === "ios" ? "ios" : "android", typeof uiLanguage === "string" ? uiLanguage : "", typeof revision === "string" ? revision : "", Array.isArray(removals) ? removals : []);
    const chain = precise ? PRECISE_CHAIN : MODEL_CHAIN;

    let b64: string | undefined;
    let waited = 0;
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
        let result;
        // Retry the same model on a rate limit rather than falling through to an
        // older one: a 429 says "later", not "not available here".
        for (let attempt = 0; ; attempt++) {
          try {
            result = useEdit
              ? await editWithOptionalFidelity(openai, model, refFiles, prompt, size, q)
              : await openai.images.generate({ model, prompt, size, quality: q, n: 1 });
            break;
          } catch (e) {
            const wait = rateLimitWaitMs(e);
            if (wait === null || attempt >= 4) throw e;
            waited += wait;
            await sleep(wait);
          }
        }

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
      // Surfaced so a slow run reads as throttling rather than as the tool hanging.
      rateLimitWaitMs: waited || undefined,
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
