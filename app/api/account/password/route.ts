import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { changePassword, userIdOf } from "@/lib/sheetsUsers";
import { logLoginToSheet } from "@/lib/sheetsLogger";
import { forgetUsers } from "@/lib/userAccess";

export const runtime = "nodejs";

/**
 * The signed-in person changes their own password.
 * Body: { current, next }. The new password is stored as a scrypt hash in the
 * Users sheet; every session signed in with the old one ends within 5 minutes
 * (lib/authOptions.ts), and the page signs this one out right away.
 *
 * Wrong current passwords are capped per account (per server instance), so a
 * stolen session cookie cannot be used to guess the password without limit.
 * Every attempt except a malformed new password is written to LoginLog.
 */
const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, number[]>();

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ success: false, error: "Chưa đăng nhập. Vui lòng đăng nhập lại." }, { status: 401 });
  const username = userIdOf(email);

  const now = Date.now();
  const recent = (fails.get(username) || []).filter(t => now - t < FAIL_WINDOW_MS);
  if (recent.length >= MAX_FAILS) {
    return NextResponse.json({ success: false, error: "Nhập sai mật khẩu hiện tại quá nhiều lần. Thử lại sau 15 phút." }, { status: 429 });
  }

  let body: { current?: unknown; next?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
  }
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  if (!current || !next) return NextResponse.json({ success: false, error: "Nhập đủ mật khẩu hiện tại và mật khẩu mới." }, { status: 400 });

  const log = (result: string) => logLoginToSheet({
    email,
    name: session?.user?.name || "",
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown",
    userAgent: req.headers.get("user-agent") || "unknown",
    result,
  });

  try {
    const res = await changePassword(username, current, next);
    if (!res.ok) {
      if (res.reason === "wrong_current") fails.set(username, [...recent, now]);
      if (res.reason !== "invalid") await log(`đổi mật khẩu thất bại: ${res.message}`);
      const status = res.reason === "write_failed" ? 502 : res.reason === "not_found" ? 403 : 400;
      return NextResponse.json({ success: false, error: res.message }, { status });
    }
    fails.delete(username);
    forgetUsers();
    await log("đổi mật khẩu");
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("change password:", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "Không đọc được sheet Users. Thử lại sau ít phút." }, { status: 502 });
  }
}
