import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { logFeedback, type FeedbackEvent } from "@/lib/learning";
import pkg from "@/package.json";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * One correction or approval in the Feedback tab (learning loop, lib/learning.ts).
 * The email comes from the session, never from the body. A failure here never
 * breaks the tool: the page ignores the answer.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user) return NextResponse.json({ success: false, error: "Chưa đăng nhập." }, { status: 401 });
  try {
    const ev = (await req.json()) as FeedbackEvent;
    if (!ev?.tool || !ev?.kind) return NextResponse.json({ success: false, error: "Thiếu tool/kind." }, { status: 400 });
    await logFeedback(session.user.email || session.user.name || "", ev, pkg.version);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("feedback:", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
