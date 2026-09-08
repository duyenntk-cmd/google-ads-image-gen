import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { appName, niche, screenshots, country, language } = await req.json() as {
      appName: string;
      niche?: string;
      screenshots?: string[];
      country?: string;
      language?: string;
    };

    if (!appName) {
      return NextResponse.json({ success: false, error: "Missing appName" }, { status: 400 });
    }

    const marketCtx = country && country !== "Global" ? `Target market: ${country}.` : "Global market.";
    const langCtx = language && language !== "English" ? `Ad copy language: ${language}.` : "";

    const imageContents: OpenAI.Chat.ChatCompletionContentPartImage[] = (screenshots || [])
      .slice(0, 2)
      .map(s => ({
        type: "image_url" as const,
        image_url: { url: s, detail: "low" as const },
      }));

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: `App: "${appName}"${niche ? `, category: ${niche}` : ""}. ${marketCtx} ${langCtx}

Write a creative direction prompt for generating Google Ads banner images for this app.`,
      },
      ...imageContents,
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `Bạn là creative director Google Ads chuyên về quảng cáo ứng dụng di động. Dựa trên thông tin app được cung cấp, viết 1-2 câu mô tả creative direction để gen banner quảng cáo Google Ads.

Mô tả bao gồm:
- Phong cách thiết kế và mood (VD: "phong cách cinematic bold, gradient tím đậm")
- Element hình ảnh chính (VD: "phone mockup hiển thị giao diện chỉnh ảnh AI")
- Cảm xúc muốn truyền tải (VD: "truyền cảm hứng sáng tạo, khiến người dùng cảm thấy mạnh mẽ")
- Đối tượng mục tiêu nếu có

Viết bằng tiếng Việt, ngắn gọn, sống động, dễ hiểu. KHÔNG lặp lại tên app. Chỉ trả về đoạn text prompt, không giải thích thêm.`,
        },
        { role: "user", content: userContent },
      ],
    });

    const prompt = response.choices[0]?.message?.content?.trim() || "";

    return NextResponse.json({ success: true, prompt });
  } catch (err) {
    console.error("Auto prompt error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
