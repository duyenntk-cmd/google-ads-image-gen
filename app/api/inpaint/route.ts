import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const { imageBase64, language, country } = await req.json();

    // Strip data URL prefix if present
    const raw = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(raw, "base64");
    const file = new File([new Uint8Array(buffer)], "image.png", { type: "image/png" });

    const marketHint = country && country !== "Global" ? ` Adapt aesthetics for ${country} market.` : "";
    const langHint = language && language !== "English"
      ? ` Replace any visible English text with ${language} translation.`
      : " Remove all visible text overlays.";

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt: `Clean up this advertisement image: remove all text overlays, watermarks, and text elements. Keep all visual elements, people, backgrounds, and colors exactly as they are.${langHint}${marketHint}`,
      n: 1,
      size: "1024x1024",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");
    return NextResponse.json({ success: true, base64: `data:image/png;base64,${b64}` });
  } catch (err) {
    console.error("Inpaint error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
