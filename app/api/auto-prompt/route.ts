import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { appName, niche, screenshots, country, language } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // The creative direction is a working note for the operator to read and edit,
    // so it is ALWAYS Vietnamese. `language` is the language of the ad copy that
    // ends up printed on the banner — a different thing, and passing it through
    // as the output language is what previously produced English directions.
    const adCopyLang = language || "Vietnamese";
    const system =
      "Bạn là creative director Google Ads chuyên app mobile. Đọc mô tả app + screenshots rồi viết một BẢN BRIEF THIẾT KẾ chi tiết.\n\n" +
      "BẮT BUỘC viết bằng TIẾNG VIỆT, kể cả khi ad copy chạy ngôn ngữ khác — đây là ghi chú để người Việt đọc và sửa.\n" +
      "NGOẠI LỆ: phần chữ sẽ IN LÊN BANNER (headline / phụ đề / tagline / CTA) phải viết bằng " + adCopyLang + ", " +
      "vì đó là chữ khách hàng sẽ đọc. Nếu " + adCopyLang + " không phải tiếng Việt thì ghi thêm nghĩa tiếng Việt trong ngoặc.\n\n" +
      "Trả về ĐÚNG cấu trúc sau, không thêm lời dẫn, không markdown ** hay #:\n\n" +
      "BỐ CỤC\n" +
      "- Nhân vật: ai, đang làm gì, đặt ở đâu trong khung, hướng nhìn\n" +
      "- Phone mockup: đặt ở đâu, màn hình hiển thị gì\n" +
      "- Đạo cụ/hiệu ứng: 2-3 thứ ĐẶC TRƯNG của app này (đừng chung chung)\n" +
      "- Vùng để chữ: chừa khoảng trống ở đâu cho logo, headline, nút\n\n" +
      "TEXT TRÊN BANNER\n" +
      "- Headline: \"...\" (tối đa 30 ký tự, nêu LỢI ÍCH không nêu tính năng)\n" +
      "- Phụ đề: \"...\" (tối đa 45 ký tự)\n" +
      "- Tagline cạnh logo: \"...\" (tối đa 32 ký tự)\n\n" +
      "CTA\n" +
      "- Nút: \"...\" (tối đa 12 ký tự, động từ hành động)\n" +
      "- Vì sao chọn câu này\n\n" +
      "MÀU SẮC\n" +
      "- Nền sáng hay tối, và vì sao\n" +
      "- Màu chủ đạo / phụ / nhấn (mã hex lấy từ screenshots thật)\n\n" +
      "TÔNG & CẢM XÚC\n" +
      "- 1-2 câu\n\n" +
      "Viết cụ thể, quyết đoán. Không dùng từ mơ hồ như \"hiện đại\", \"thân thiện\" mà không kèm chi tiết hình ảnh.";
    const shots: string[] = Array.isArray(screenshots) ? screenshots.slice(0, 2) : [];
    const userContent: any[] = [
      {
        type: "text",
        text:
          `App: "${appName}"\nNiche: ${niche || "unknown"}\nThị trường: ${country || "Global"}\n` +
          `Ngôn ngữ ad copy: ${adCopyLang} — dùng cho phần chữ IN LÊN BANNER.\n` +
          `Mọi phần giải thích/mô tả khác vẫn viết bằng tiếng Việt.\n` +
          `Viết brief thiết kế chi tiết theo đúng cấu trúc đã cho. ` +
          `Headline/phụ đề/tagline/CTA viết bằng ${adCopyLang}.`,
      },
      ...shots.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 900,
      temperature: 0.8,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });

    const prompt = completion.choices[0]?.message?.content?.trim() || "";
    return NextResponse.json({ success: true, prompt });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Lỗi auto-prompt." },
      { status: 500 },
    );
  }
}
