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
      "Bạn là creative director Google Ads chuyên app mobile. Nhìn app và (nếu có) screenshots, " +
      "viết 1-2 câu mô tả creative direction: visual style, hero element, cảm xúc muốn truyền tải.\n" +
      "BẮT BUỘC: viết bằng TIẾNG VIỆT, kể cả khi ad copy sẽ chạy bằng ngôn ngữ khác. " +
      "Đây là ghi chú để người Việt đọc và chỉnh sửa, không phải chữ in lên banner.\n" +
      "Chỉ trả về đoạn mô tả, KHÔNG giải thích, KHÔNG markdown, KHÔNG tiền tố.";

    const shots: string[] = Array.isArray(screenshots) ? screenshots.slice(0, 2) : [];
    const userContent: any[] = [
      {
        type: "text",
        text:
          `App: "${appName}"\nNiche: ${niche || "unknown"}\nThị trường: ${country || "Global"}\n` +
          `Ad copy sẽ viết bằng: ${adCopyLang} (chỉ để bạn tham khảo — phần mô tả bên dưới vẫn phải bằng tiếng Việt)\n` +
          `Viết creative direction ngắn gọn, punchy, BẰNG TIẾNG VIỆT.`,
      },
      ...shots.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
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
