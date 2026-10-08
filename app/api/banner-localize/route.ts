import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Translates the four strings the canvas prints, for one more market.
 *
 * Nothing here touches the artwork. The overlay is redrawn on the artwork
 * already paid for, so a second market costs a fraction of a cent instead of
 * the ~28,000₫ a fresh set of twenty images costs.
 *
 * What it cannot change is the interface inside the phone mockup: those words
 * are pixels the image model painted, not text the canvas draws. A market that
 * has to show its own phone UI needs a real generation run.
 */
const LIMITS = "headline <=30, subheadline <=45, cta_text <=12, tagline <=32";

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { copy, language, country, appName } = await req.json();
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }
    if (!copy || !language) {
      return NextResponse.json({ success: false, error: "Thiếu copy hoặc ngôn ngữ." }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `Bạn là copywriter quảng cáo app bản địa cho thị trường ${country || language}.\n` +
            `Viết lại bộ chữ quảng cáo dưới đây bằng ${language}.\n\n` +
            `- Dịch THOÁT ý, viết như người bản xứ viết quảng cáo, KHÔNG dịch máy từng từ.\n` +
            `- Giữ đúng thông điệp và mức độ khẩn trương của bản gốc.\n` +
            `- Tôn trọng giới hạn ký tự, đây là giới hạn CỨNG vì chữ vẽ lên ảnh: ${LIMITS}.\n` +
            `- Giữ nguyên tên app "${appName || ""}" nếu nó xuất hiện — thương hiệu không dịch.\n` +
            `- Trả về DUY NHẤT JSON với đúng các key: headline, subheadline, cta_text, tagline.`,
        },
        { role: "user", content: JSON.stringify(copy) },
      ],
    });

    let out: Record<string, unknown>;
    try {
      out = JSON.parse(completion.choices[0]?.message?.content?.trim() || "{}");
    } catch {
      return NextResponse.json({ success: false, error: "GPT trả về JSON không hợp lệ." }, { status: 502 });
    }

    // Anything missing or over-long falls back to the source string: a banner
    // with the original wording beats a banner with a clipped word on it.
    const take = (k: string, max: number) => {
      const v = out[k];
      if (typeof v !== "string" || !v.trim()) return copy[k] || "";
      return v.trim().length > max ? v.trim().slice(0, max).trim() : v.trim();
    };

    return NextResponse.json({
      success: true,
      copy: {
        headline: take("headline", 30),
        subheadline: take("subheadline", 45),
        cta_text: take("cta_text", 12),
        tagline: take("tagline", 32),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error)?.message || "Lỗi banner-localize." },
      { status: 500 },
    );
  }
}
