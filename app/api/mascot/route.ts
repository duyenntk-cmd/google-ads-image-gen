import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 120;

const NICHE_CHAR: Record<string, string> = {
  photo: "a stylish creative character",
  tool: "a friendly helper robot or assistant character",
  office: "a smart professional character",
  game: "a playful energetic game-style character",
  health: "a warm wellness coach character",
  finance: "a confident smart character",
  social: "a cheerful outgoing character",
  travel: "an adventurous character",
  education: "a friendly cheerful young tutor character",
};

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const { appName, niche, screenshots, brief, quality } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const shots: string[] = Array.isArray(screenshots) ? screenshots.filter(Boolean) : [];

    // 1) Try to FIND a mascot in the app's own screenshots.
    if (shots.length) {
      const detectSystem =
        'Bạn soi screenshot app để tìm nhân vật/mascot (người, sinh vật, hoặc avatar) có thể làm hero cho quảng cáo. ' +
        'Chỉ trả JSON: {"found": boolean, "index": number, "description": string}. ' +
        "index = screenshot hiển thị nhân vật rõ & đầy đủ nhất (0-based). Không có nhân vật phù hợp thì found=false.";
      const detectContent: any[] = [
        { type: "text", text: `App: "${appName}". Có nhân vật/mascot nào trong các screenshot dưới đây không?` },
        ...shots.slice(0, 4).map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
      ];
      try {
        const detect = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 200,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: detectSystem },
            { role: "user", content: detectContent },
          ],
        });
        const parsed = JSON.parse(detect.choices[0]?.message?.content || "{}");
        if (parsed.found && typeof parsed.index === "number" && shots[parsed.index]) {
          return NextResponse.json({
            success: true,
            source: "screenshot",
            index: parsed.index,
            description: parsed.description || "",
          });
        }
      } catch {
        /* fall through to generation */
      }
    }

    // 2) Generate a mascot once (to be reused across all sizes).
    const primary = brief?.primary_color || "#7B2FBE";
    const accent = brief?.accent_color || "#FF6B35";
    const charBase = NICHE_CHAR[niche || brief?.niche] || "a friendly mascot character";
    const q = (["low", "medium", "high"].includes(quality) ? quality : "medium") as "low" | "medium" | "high";

    const prompt = `A single ${charBase} as the brand mascot for the app "${appName}".
Polished modern 3D cartoon (Pixar-style), full body or 3/4 view, centered, expressive, welcoming, friendly pose (e.g. waving or gesturing).
Soft studio lighting. Plain simple neutral light-gradient background. Color hints: ${primary} and ${accent}.
STRICT: only the character, NOTHING else. NO text, NO letters, NO logos, NO UI, NO phone, NO props with text. Clean and centered.`;

    // The mascot is the consistency anchor for all 20 banners — render it on the
    // newest model available, falling back if the account can't reach one.
    let b64: string | undefined;
    const tried: string[] = [];
    for (const model of ["gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"]) {
      try {
        const gen = await openai.images.generate({ model, prompt, size: "1024x1024", quality: q, n: 1 });
        b64 = gen.data?.[0]?.b64_json;
        if (b64) break;
        tried.push(`${model}: không trả ảnh`);
      } catch (err) {
        const e = err as { status?: number; response?: { status?: number }; message?: string };
        const status = e?.status ?? e?.response?.status;
        const msg = String(e?.message || "").toLowerCase();
        const unavailable =
          status === 404 ||
          (status === 403 && (msg.includes("model") || msg.includes("access"))) ||
          msg.includes("does not exist") ||
          msg.includes("not found") ||
          msg.includes("do not have access") ||
          msg.includes("must be verified");
        tried.push(`${model}: ${e?.message || err}`);
        if (unavailable) continue;
        throw err;
      }
    }
    if (!b64) throw new Error("Không tạo được mascot. " + tried.join(" | "));

    return NextResponse.json({ success: true, source: "generated", dataUrl: `data:image/png;base64,${b64}` });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Lỗi mascot." }, { status: 500 });
  }
}
