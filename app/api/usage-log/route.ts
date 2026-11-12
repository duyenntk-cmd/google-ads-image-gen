import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { logUsage, type UsageEvent } from "@/lib/usageLog";
import pkg from "@/package.json";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Appends one usage row. The email comes from the session, never from the body. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user) return NextResponse.json({ success: false, error: "Chưa đăng nhập." }, { status: 401 });
  try {
    const ev = (await req.json()) as UsageEvent;
    if (!ev?.tool || !ev?.action) return NextResponse.json({ success: false, error: "Thiếu tool/action." }, { status: 400 });
    await logUsage(session.user.email || session.user.name || "", ev, pkg.version);
    return NextResponse.json({ success: true });
  } catch (e) {
    // A logging failure must never break the tool; the client ignores it.
    console.error("usage-log:", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
