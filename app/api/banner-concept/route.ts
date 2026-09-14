import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const BRIEF_SCHEMA = `Trả về DUY NHẤT một JSON object (không markdown, không giải thích) với đúng các key sau:
{
  "app_name": string,
  "tagline": string,         // <=32 ký tự, mô tả ngắn app (đặt cạnh logo), vd "AI learning app"
  "headline": string,        // <=30 ký tự, benefit punchy (hook)
  "subheadline": string,     // <=45 ký tự
  "cta_text": string,        // <=12 ký tự, động từ hành động, khẩn trương
  "primary_color": string,   // hex, LẤY TỪ screenshots thật, không đoán
  "secondary_color": string, // hex
  "accent_color": string,    // hex
  "mood": "bold" | "lifestyle" | "minimal" | "product" | "playful" | "professional",
  "niche": "photo" | "tool" | "office" | "game" | "health" | "finance" | "social" | "travel" | "education",
  "text_zone": "top" | "bottom" | "left" | "right",
  "subject_position": "center" | "left" | "right"
}`;

export async function POST(req: NextRequest) {
  try {
    const { appName, prompt, country, language, screenshots } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const outLang = language || "Vietnamese";

    const system = `Bạn là senior art director cho quảng cáo app mobile trên Google Ads. Phân tích screenshots + creative direction để tạo design brief. Headline/subheadline/cta viết bằng ${outLang}, ngắn và chuyển đổi cao. Màu sắc PHẢI trích từ screenshots thật.\n\n${BRIEF_SCHEMA}`;

    const shots: string[] = Array.isArray(screenshots) ? screenshots.slice(0, 3) : [];
    const userContent: any[] = [
      {
        type: "text",
        text: `App: "${appName}"\nThị trường: ${country || "Global"}\nCreative direction: ${prompt || "(chưa có, tự đề xuất)"}\n\nDựa vào screenshots dưới đây, tạo brief.`,
      },
      ...shots.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    let brief: any;
    try {
      brief = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { success: false, error: "GPT trả về JSON không hợp lệ.", raw: raw.slice(0, 300) },
        { status: 502 },
      );
    }

    // Fill safe defaults so the generator never breaks on a missing field.
    brief.app_name ||= appName;
    brief.tagline ||= "";
    brief.headline ||= appName;
    brief.subheadline ||= "";
    brief.cta_text ||= outLang === "Vietnamese" ? "Tải ngay" : "Get it now";
    brief.primary_color ||= "#7B2FBE";
    brief.secondary_color ||= "#1A1A2E";
    brief.accent_color ||= "#FF6B35";
    brief.mood ||= "bold";
    brief.niche ||= "tool";
    brief.text_zone ||= "bottom";
    brief.subject_position ||= "center";

    return NextResponse.json({ success: true, brief });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Lỗi banner-concept." },
      { status: 500 },
    );
  }
}
