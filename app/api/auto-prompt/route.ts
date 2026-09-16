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

    const outLang = language || "Vietnamese";
    const system = `Bạn là creative director Google Ads chuyên app mobile. Nhìn app và (nếu có) screenshots, viết 1-2 câu mô tả creative direction: visual style, hero element, cảm xúc muốn truyền tải. Viết bằng ${outLang}. Chỉ trả về text prompt, KHÔNG giải thích, KHÔNG markdown, KHÔNG tiền tố.`;

    const shots: string[] = Array.isArray(screenshots) ? screenshots.slice(0, 2) : [];
    const userContent: any[] = [
      {
        type: "text",
        text: `App: "${appName}"\nNiche: ${niche || "unknown"}\nThị trường: ${country || "Global"}\nViết creative direction ngắn gọn, punchy.`,
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
