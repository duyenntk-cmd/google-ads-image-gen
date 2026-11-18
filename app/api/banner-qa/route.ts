import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI review of ONE finished banner (artwork + the text the canvas printed), the
 * gate that lets the chat's auto mode skip the human draft review (chat/studio.mjs
 * `qa` / `auto`). It looks for what people most often send back for a redo:
 * printed text over the character or the phone, text cut off, a second
 * character, broken hands or faces, stray lettering in the artwork, the wrong
 * language. A failing banner comes back with a one-sentence fix that is passed
 * as the `revision` of a regeneration.
 *
 * Body: { image: dataUrl (≤1024px is plenty), language, copy: { headline, subheadline, cta_text, tagline? }, slot? }
 * Model: QA_MODEL (default gpt-4o), detail "high".
 */
const ISSUE_TYPES = ["text_overlap", "text_cut", "extra_character", "anatomy", "stray_text", "wrong_language", "other"] as const;

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { image, language, copy, slot } = await req.json();
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json({ success: false, error: "Thiếu ảnh (data URL)." }, { status: 400 });
    }
    const model = process.env.QA_MODEL || "gpt-4o";
    const texts = copy && typeof copy === "object"
      ? Object.entries(copy as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => `${k}: "${v}"`).join("\n")
      : "";

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You review finished mobile-app install banners before they go to Google Ads, the way a strict art director would. " +
            "The artwork is AI-generated; the headline, subheadline, CTA button, app icon, app name and store badge were printed on top afterwards.\n" +
            "Fail the banner for any of these, and only these:\n" +
            "- text_overlap: printed text, the CTA button, the icon or the badge covers the character's face, head or hands, or covers the phone screen.\n" +
            "- text_cut: any printed text is cut off by the edge, hidden, or unreadable against the background.\n" +
            "- extra_character: more than one character / face in the artwork (small faces shown inside the phone's app UI do not count).\n" +
            "- anatomy: malformed hands (extra or missing fingers, fused fingers), distorted face, extra limbs.\n" +
            "- stray_text: lettering painted into the artwork outside the phone screen (fake words, fake logos, watermarks).\n" +
            `- wrong_language: the printed copy is not in ${language || "the expected language"}.\n` +
            "Small stylistic preferences are NOT failures. When unsure, pass.\n" +
            'Answer ONLY JSON: {"pass": true|false, "issues": [{"type": "<one of the types>", "detail": "<short, where in the image>"}], ' +
            '"fix": "<if failing: ONE sentence, in English, telling the image model how to redraw the ARTWORK so the problem goes away, e.g. keep the top 30% empty for the headline; empty string if passing>"}',
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Banner${slot ? ` (${slot})` : ""}. Printed copy, expected in ${language || "the market's language"}:\n${texts || "(not given)"}` },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ],
        },
      ],
    });

    let out: { pass?: unknown; issues?: unknown; fix?: unknown } = {};
    try { out = JSON.parse(completion.choices[0]?.message?.content || "{}"); } catch { /* treated as not reviewed */ }
    const issues = (Array.isArray(out.issues) ? out.issues : [])
      .map((i: { type?: unknown; detail?: unknown }) => ({
        type: (ISSUE_TYPES as readonly string[]).includes(String(i?.type)) ? String(i.type) : "other",
        detail: String(i?.detail ?? "").slice(0, 300),
      }))
      .slice(0, 6);
    if (typeof out.pass !== "boolean") {
      return NextResponse.json({ success: false, error: "AI không trả lời đúng định dạng, chưa kiểm tra được ảnh này." }, { status: 502 });
    }
    // A pass that still lists issues is treated as a fail: the gate errs on the side of a person looking.
    const pass = out.pass && issues.length === 0;
    return NextResponse.json({ success: true, pass, issues, fix: pass ? "" : String(out.fix ?? "").slice(0, 400), model });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
