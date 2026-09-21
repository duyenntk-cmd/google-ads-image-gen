import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Tells you why OpenAI calls are failing, without anyone having to handle the key.
 *
 * GET /api/health/openai          — key validity + which org owns it (free, no credits used)
 * GET /api/health/openai?gen=1    — also renders one low-quality image (~$0.006)
 *
 * The listing endpoint is not billed, so it answers the question a 429 cannot:
 * a valid key with no balance still lists models fine. If this returns 200 while
 * generation returns "no credits remaining", the key is simply attached to a
 * different organization than the one that was topped up.
 */
export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, step: "env", error: "Thiếu OPENAI_API_KEY trong Vercel env vars." }, { status: 500 });
  }

  // Never echo the key. The prefix and last 4 are enough to match it against the
  // dashboard, and the prefix alone explains a lot: sk-proj- keys are scoped to a
  // project, which carries its own budget limit separate from the org balance.
  const scope = key.startsWith("sk-proj-")
    ? "project-scoped (sk-proj-) — kiểm tra CẢ trần ngân sách của project, không chỉ số dư org"
    : key.startsWith("sk-")
      ? "user/org-scoped (sk-)"
      : "định dạng lạ — kiểm tra lại giá trị đã dán vào Vercel";
  const fingerprint = `${key.slice(0, 8)}…${key.slice(-4)} (dài ${key.length})`;

  const out: Record<string, unknown> = { keyScope: scope, keyFingerprint: fingerprint };

  // 1) Is the key valid, and whose org is it? Listing models costs nothing.
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();

    // OpenAI echoes the owning organization and project on every response.
    out.organization = res.headers.get("openai-organization") || "(không có header)";
    out.project = res.headers.get("openai-project") || "(không có header)";
    out.listStatus = res.status;

    if (!res.ok) {
      out.ok = false;
      out.step = "auth";
      out.error = body.slice(0, 400);
      out.verdict =
        res.status === 401
          ? "Key KHÔNG hợp lệ hoặc đã bị xoá. Tạo key mới rồi cập nhật vào Vercel."
          : `Gọi /v1/models thất bại (HTTP ${res.status}).`;
      return NextResponse.json(out, { status: 200 });
    }

    const parsed = JSON.parse(body) as { data?: { id: string }[] };
    const ids = (parsed.data || []).map((m) => m.id);
    out.modelCount = ids.length;
    out.imageModels = ids.filter((id) => id.includes("image")).sort();
    out.hasGptImage25 = ids.some((id) => id.startsWith("gpt-image-2.5"));
    out.hasGptImage2 = ids.includes("gpt-image-2");
  } catch (e) {
    return NextResponse.json(
      { ...out, ok: false, step: "network", error: (e as Error)?.message || String(e) },
      { status: 200 },
    );
  }

  // The key works. Anything failing now is billing, not authentication.
  out.ok = true;
  out.verdict =
    `Key HỢP LỆ và thuộc organization "${out.organization}". ` +
    `Nếu gen ảnh vẫn báo "no credits remaining" thì tiền đã nạp vào org KHÁC org này — ` +
    `hãy mở platform.openai.com, chuyển sang đúng org trên, và nạp credit ở đó.`;

  // 2) Optional: prove the billed path end to end for about $0.006.
  if (req.nextUrl.searchParams.get("gen") === "1") {
    for (const model of ["gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1"]) {
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: "a single small blue circle on white", size: "1024x1024", quality: "low", n: 1 }),
          signal: AbortSignal.timeout(90000),
        });
        const text = await res.text();
        if (res.ok) {
          out.genTest = { ok: true, model, note: "Gen ảnh CHẠY ĐƯỢC. Credit ổn." };
          break;
        }
        out.genTest = { ok: false, model, status: res.status, error: text.slice(0, 300) };
        // 404 / 403 means this model is out of reach; try an older one.
        if (res.status !== 404 && res.status !== 403) break;
      } catch (e) {
        out.genTest = { ok: false, model, error: (e as Error)?.message || String(e) };
        break;
      }
    }
  }

  return NextResponse.json(out, { status: 200 });
}
