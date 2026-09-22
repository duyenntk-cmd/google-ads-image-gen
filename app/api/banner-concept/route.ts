import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

const BRIEF_SCHEMA = `Trả về DUY NHẤT một JSON object (không markdown, không giải thích) với đúng các key sau:
{
  "app_name": string,
  "tagline": string,         // <=32 ký tự, mô tả ngắn app (đặt cạnh logo), vd "AI learning app"
  "headline": string,        // TỐI ĐA 30 KÝ TỰ — đếm kỹ, đây là giới hạn CỨNG.
                             // Càng ngắn càng mạnh. BỎ từ đệm: "một cách", "nhằm",
                             // "để có thể", "giúp bạn", "vô cùng", "cực kỳ".
                             // "Học ngôn ngữ thông minh" (23) MẠNH HƠN
                             // "Học ngôn ngữ một cách thông minh" (31, thừa "một cách").
  "subheadline": string,     // <=45 ký tự
  "cta_text": string,        // <=12 ký tự, động từ hành động, khẩn trương
  "primary_color": string,   // hex, LẤY TỪ screenshots thật, không đoán
  "secondary_color": string, // hex
  "accent_color": string,    // hex
  "mood": "bold" | "lifestyle" | "minimal" | "product" | "playful" | "professional",
  "niche": "photo" | "tool" | "office" | "game" | "health" | "finance" | "social" | "travel" | "education" | "beauty" | "shopping",
  "bg_mode": "light" | "dark",  // nền sáng (trắng/pastel, thoáng) hay tối (gradient đậm, tương phản cao)
  "hero_subject": string,    // TIẾNG ANH. Nhân vật/chủ thể chính nên là gì và đang làm gì.
                             // vd "a young woman admiring her newly coloured hair in a hand mirror"
  "key_visual": string,      // TIẾNG ANH. 2-3 đạo cụ/hiệu ứng ĐẶC TRƯNG của app này, KHÔNG chung chung.
                             // CHỈ là ĐỒ VẬT/hiệu ứng. KHÔNG được là nhân vật/mascot/robot thứ hai —
                             // banner chỉ có DUY NHẤT một nhân vật là hero_subject.
                             // vd app làm tóc: "floating hair-colour swatch circles, a before/after split, soft sparkles"
                             // vd app học ngôn ngữ: "speech bubbles with small country flags, a globe"
                             // TUYỆT ĐỐI không dùng cờ quốc gia trừ khi app thật sự về ngôn ngữ/du lịch
  "text_zone": "top" | "bottom" | "left" | "right",
  "subject_position": "center" | "left" | "right"
}

LƯU Ý NGÔN NGỮ: headline/subheadline/cta_text/tagline viết bằng ngôn ngữ ad copy được chỉ định.
Riêng hero_subject và key_visual PHẢI viết bằng TIẾNG ANH vì chúng được đưa thẳng vào model tạo ảnh.`;

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { appName, prompt, country, language, screenshots, description, genre } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const outLang = language || "Vietnamese";

    const system =
      `Bạn là senior art director cho quảng cáo app mobile trên Google Ads. ` +
      `Phân tích mô tả app + screenshots + creative direction để tạo design brief.\n\n` +
      `LUẬT SỐ 1 — NGÔN NGỮ, CAO HƠN MỌI LUẬT KHÁC:\n` +
      `headline, subheadline, cta_text, tagline PHẢI viết bằng ${outLang}. Không ngoại lệ.\n` +
      `Creative direction bên dưới là ghi chú nội bộ, thường viết bằng TIẾNG VIỆT — đó chỉ là\n` +
      `ngôn ngữ ghi chú, KHÔNG phải ngôn ngữ của banner.\n` +
      `Nếu câu chữ trong đó KHÔNG phải ${outLang} thì DỊCH tự nhiên sang ${outLang}\n` +
      `(dịch theo ý, cho thuận tai người bản xứ, không dịch máy từng từ), giữ nguyên thông điệp.\n` +
      `Nếu có phần nghĩa ghi trong ngoặc (thường là tiếng Việt) thì BỎ HẲN phần trong ngoặc đó.\n\n` +
      `TÔN TRỌNG CREATIVE DIRECTION (sau khi đã tuân thủ luật số 1):\n` +
      `Creative direction do người dùng viết hoặc đã duyệt. Nếu trong đó đã ghi rõ\n` +
      `Headline / Phụ đề / Tagline / CTA thì GIỮ ĐÚNG Ý những câu đó — dùng nguyên văn khi\n` +
      `câu đó đã đúng ${outLang}, còn lại thì dịch. TUYỆT ĐỐI KHÔNG tự nghĩ thông điệp khác.\n` +
      `Tương tự với bố cục, màu sắc, đạo cụ: nếu đã được nêu thì bám theo, đừng sáng tạo lại.\n` +
      `Chỉ tự đề xuất khi creative direction không nói gì về mục đó.\n\n` +
      `Headline/subheadline/cta viết bằng ${outLang}, ngắn và chuyển đổi cao.\n` +
      `Màu sắc PHẢI trích từ screenshots thật, không đoán.\n` +
      `hero_subject và key_visual phải bám SÁT chức năng thật của app — đọc kỹ mô tả để biết app làm gì, ` +
      `đừng suy diễn từ tên app.\n\n${BRIEF_SCHEMA}`;

    const shots: string[] = Array.isArray(screenshots) ? screenshots.slice(0, 3) : [];
    const userContent: any[] = [
      {
        type: "text",
        text:
          `App: "${appName}"\n` +
          (genre ? `Thể loại trên store: ${genre}\n` : "") +
          (description ? `Mô tả từ store (nguồn đáng tin nhất về chức năng app):\n"""${String(description).slice(0, 900)}"""\n` : "") +
          `Thị trường: ${country || "Global"}\n` +
          `Ngôn ngữ ad copy: ${outLang}\n` +
          (prompt
            ? `--- CREATIVE DIRECTION (người dùng đã duyệt — bám sát, đặc biệt là phần chữ) ---\n${prompt}\n--- hết ---\n\n`
            : `Creative direction: (chưa có, tự đề xuất)\n\n`) +
          `Dựa vào mô tả và screenshots dưới đây, tạo brief.`,
      },
      ...shots.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 700,
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
    // A headline over the limit wraps to an extra line and reads flabby. Drop the
    // usual filler first; only trim at a word boundary if it is still too long.
    if (typeof brief.headline === "string" && brief.headline.length > 30) {
      brief.headline = brief.headline
        .replace(/\s+(một cách|theo cách|nhằm|để có thể|giúp bạn|vô cùng|cực kỳ)\s+/gi, " ")
        .trim();
      if (brief.headline.length > 30) {
        const cut = brief.headline.slice(0, 30);
        brief.headline = cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim();
      }
    }
    brief.subheadline ||= "";
    brief.cta_text ||= outLang === "Vietnamese" ? "Tải ngay" : "Get it now";
    brief.primary_color ||= "#7B2FBE";
    brief.secondary_color ||= "#1A1A2E";
    brief.accent_color ||= "#FF6B35";
    brief.mood ||= "bold";
    brief.niche ||= "tool";
    brief.bg_mode = brief.bg_mode === "dark" ? "dark" : "light";
    brief.hero_subject ||= "a friendly person happily using the app on a smartphone";
    brief.key_visual ||= "soft floating UI cards and gentle sparkles";
    brief.text_zone ||= "bottom";
    brief.subject_position ||= "center";

    // Last line of defence on the language rule. The creative direction is
    // written in Vietnamese by design, and told to copy it the model sometimes
    // copies the language too — which is how a German campaign shipped a
    // Vietnamese headline. Characters below are Vietnamese-only; accented
    // French or Spanish does not match, so this cannot fire on those.
    if (outLang !== "Vietnamese") {
      const VI_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯầấậẩẫằắặẳẵềếệểễồốộổỗờớợởỡừứựửữạảẹẻịỉọỏụủỵỷỹ]/;
      const COPY_FIELDS = ["headline", "subheadline", "cta_text", "tagline"] as const;
      const offenders = COPY_FIELDS.filter((f) => typeof brief[f] === "string" && VI_ONLY.test(brief[f]));
      if (offenders.length) {
        try {
          const fix = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 200,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [{
              role: "user",
              content:
                `Dịch các câu quảng cáo sau sang ${outLang}, dịch THOÁT ý cho thuận tai người bản xứ, ` +
                `giữ đúng giới hạn ký tự: headline <=30, subheadline <=45, cta_text <=12, tagline <=32. ` +
                `Trả về JSON đúng các key đã cho, không thêm key nào khác.\n` +
                JSON.stringify(Object.fromEntries(offenders.map((f) => [f, brief[f]]))),
            }],
          });
          const t = JSON.parse(fix.choices[0]?.message?.content?.trim() || "{}");
          for (const f of offenders) if (typeof t[f] === "string" && t[f].trim()) brief[f] = t[f].trim();
        } catch { /* non-fatal: better a Vietnamese headline than no brief at all */ }
      }
    }

    return NextResponse.json({ success: true, brief });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Lỗi banner-concept." },
      { status: 500 },
    );
  }
}
