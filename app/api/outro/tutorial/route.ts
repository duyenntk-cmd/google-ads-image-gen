import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Outro Studio: which frames of a video ad are a "how it was made" tutorial.
 *
 * Some ads end with a segment that films a real phone (often on a table or
 * in a hand, with a finger or stylus tapping) showing TikTok / CapCut / an
 * AI app's interface, or a screen recording of that interface. It looks
 * nothing like the app being advertised, so the page cuts it.
 *
 * The page sends small JPEG frames sampled in order (about one a second) and
 * gets back one true/false per frame; it then finds the runs and the exact
 * scene cut itself. gpt-4o-mini with detail "low" costs ~85 tokens a frame.
 */

const MAX_FRAMES = 80;
const MAX_IMG_CHARS = 300_000; // a ~288px JPEG data URL is ~20–40k

const SYSTEM = `You label frames sampled in order from a vertical mobile video ad for an AI photo / AI video app.

Some of these ads contain a TUTORIAL segment (usually at the end) showing how the AI video or photo was made. It looks different from the ad itself:
- a real phone or tablet filmed by a camera: you can see the device body, bezel or case, often lying on a table or held in a hand, sometimes a finger or stylus tapping the screen;
- or a screen recording of an app being navigated: TikTok / CapCut / Instagram / an AI app's interface with search bar, like-comment-share column, comment box, "Use template" / "Try this template" / "Essaie ce modèle" / "CapCut" buttons, menus, editing timelines, upload or gallery pickers.
Mark those frames tutorial=true.

Mark tutorial=false for the ad content itself: full-screen AI-generated videos or photos, before/after comparisons, people or characters, captions or titles over the video, transitions, and the app's own end card or logo screen. A small watermark or a single overlaid button does not make a frame a tutorial.

Return only JSON: {"labels":[{"i":<frame number>,"tutorial":true|false}],"note":"<one short sentence on what the tutorial part shows, or empty>"}. Label every frame.`;

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
  }
  try {
    const body = await req.json();
    const frames: { t: number; img: string }[] = Array.isArray(body?.frames) ? body.frames : [];
    if (!frames.length) return NextResponse.json({ success: false, error: "Không có khung hình." }, { status: 400 });
    if (frames.length > MAX_FRAMES) {
      return NextResponse.json({ success: false, error: `Tối đa ${MAX_FRAMES} khung.` }, { status: 400 });
    }
    for (const f of frames) {
      if (typeof f?.img !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(f.img) || f.img.length > MAX_IMG_CHARS) {
        return NextResponse.json({ success: false, error: "Khung hình không hợp lệ." }, { status: 400 });
      }
    }

    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: `${frames.length} frames, in order. Label each one.` },
    ];
    frames.forEach((f, i) => {
      content.push({ type: "text", text: `Frame ${i} (t=${Number(f.t).toFixed(1)}s)` });
      content.push({ type: "image_url", image_url: { url: f.img, detail: "low" } });
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 200 + frames.length * 20,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}") as {
      labels?: { i?: number; tutorial?: boolean }[];
      note?: string;
    };
    const labels = frames.map(() => false);
    for (const l of parsed.labels || []) {
      const i = Number(l?.i);
      if (Number.isInteger(i) && i >= 0 && i < labels.length) labels[i] = l?.tutorial === true;
    }
    return NextResponse.json({ success: true, labels, note: String(parsed.note || "").slice(0, 200) });
  } catch (e) {
    console.error("[outro-tutorial]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Lỗi nhận diện." },
      { status: 500 },
    );
  }
}
