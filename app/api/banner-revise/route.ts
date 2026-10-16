import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Folds a revision request into the brief.
 *
 * Appending "remove the chat bubbles" to the prompt did not remove them: the
 * SUPPORTING VISUALS section still asked for them by name, so the model was
 * handed a positive instruction and a negative one and followed the positive.
 * Image models are like that — a described thing tends to appear whatever else
 * the prompt says about it.
 *
 * So a removal has to edit the description rather than argue with it. This
 * rewrites hero_subject, key_visual and the palette to match the request, and
 * separately returns what must not appear, in English, for the prompt's negative
 * list. Absent from the description AND explicitly forbidden is far stronger
 * than either alone.
 *
 * Costs a fraction of a cent on gpt-4o-mini, against ~1,400₫ for the image it
 * saves regenerating twice.
 */
const REVISE_SCHEMA = `Trả về DUY NHẤT một JSON object, không markdown:
{
  "hero_subject": string,   // TIẾNG ANH. Mô tả nhân vật sau khi áp dụng yêu cầu.
  "key_visual": string,     // TIẾNG ANH. Đạo cụ/hiệu ứng SAU KHI SỬA.
                            // Nếu người dùng bảo BỎ thứ gì, thì thứ đó phải BIẾN MẤT
                            // khỏi chuỗi này — không nhắc tên, không thay bằng thứ tương tự.
                            // Bỏ xong mà không còn đạo cụ nào thì để chuỗi rỗng "".
  "bg_mode": "light" | "dark",
  "primary_color": string,  // hex
  "accent_color": string,   // hex
  "removals": string[]      // TIẾNG ANH, mỗi phần tử là MỘT thứ phải KHÔNG xuất hiện.
                            // Cụ thể, ngắn. vd "speech bubble chips containing words"
                            // Không có gì cần bỏ thì trả mảng rỗng [].
}`;

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { brief, revision } = await req.json();
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }
    if (!brief || !revision?.trim()) {
      return NextResponse.json({ success: false, error: "Thiếu brief hoặc yêu cầu sửa." }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const system =
      "Bạn là art director. Người dùng đã xem một banner và yêu cầu sửa một chi tiết.\n" +
      "Nhiệm vụ: viết lại phần mô tả hình ảnh SAO CHO ĐÃ ÁP DỤNG yêu cầu đó.\n\n" +
      "QUY TẮC QUAN TRỌNG NHẤT — khi người dùng bảo BỎ / XOÁ / KHÔNG MUỐN một thứ:\n" +
      "- Thứ đó phải BIẾN MẤT hoàn toàn khỏi key_visual và hero_subject.\n" +
      "- TUYỆT ĐỐI KHÔNG thay nó bằng thứ tương tự. Bỏ bong bóng chat thì KHÔNG được\n" +
      "  thay bằng bong bóng khác, nhãn khác, hay chữ khác. Chỗ đó để TRỐNG.\n" +
      "- Đồng thời ghi thứ đó vào mảng removals để cấm tuyệt đối.\n\n" +
      "Yêu cầu khác (đổi màu, đổi tư thế, đổi nền) thì chỉnh đúng phần liên quan,\n" +
      "giữ nguyên mọi thứ người dùng không nhắc tới.\n\n" +
      REVISE_SCHEMA;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            `Mô tả hiện tại:\n` +
            `hero_subject: ${brief.hero_subject || ""}\n` +
            `key_visual: ${brief.key_visual || ""}\n` +
            `bg_mode: ${brief.bg_mode || "light"}\n` +
            `primary_color: ${brief.primary_color || ""}\n` +
            `accent_color: ${brief.accent_color || ""}\n\n` +
            `YÊU CẦU SỬA CỦA NGƯỜI DÙNG:\n"""${String(revision).slice(0, 600)}"""`,
        },
      ],
    });

    let out: Record<string, unknown>;
    try {
      out = JSON.parse(completion.choices[0]?.message?.content?.trim() || "{}");
    } catch {
      return NextResponse.json({ success: false, error: "GPT trả về JSON không hợp lệ." }, { status: 502 });
    }

    // Only the visual fields move. Copy, sizes and everything the canvas draws
    // stay exactly as approved.
    const updated = {
      ...brief,
      hero_subject: typeof out.hero_subject === "string" && out.hero_subject ? out.hero_subject : brief.hero_subject,
      key_visual: typeof out.key_visual === "string" ? out.key_visual : brief.key_visual,
      bg_mode: out.bg_mode === "dark" ? "dark" : "light",
      primary_color: typeof out.primary_color === "string" && /^#[0-9a-f]{6}$/i.test(out.primary_color) ? out.primary_color : brief.primary_color,
      accent_color: typeof out.accent_color === "string" && /^#[0-9a-f]{6}$/i.test(out.accent_color) ? out.accent_color : brief.accent_color,
    };
    const removals = Array.isArray(out.removals)
      ? out.removals.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 8)
      : [];

    return NextResponse.json({ success: true, brief: updated, removals });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error)?.message || "Lỗi banner-revise." },
      { status: 500 },
    );
  }
}
