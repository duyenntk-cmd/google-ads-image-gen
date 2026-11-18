import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { requireCapability, requireSession } from "@/lib/apiAuth";
import { proposeLessons, qualityStats, readLessons, recentFeedback, reviewLesson } from "@/lib/learning";
import { isLessonStatus, isLessonTarget } from "@/lib/learningShared";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Bài học page: correction rate per version, recent corrections, lessons. Anyone signed in can read. */
export async function GET() {
  const unauth = await requireSession();
  if (unauth) return unauth;
  try {
    const [stats, recent, lessons] = await Promise.all([qualityStats(), recentFeedback(30), readLessons()]);
    return NextResponse.json({
      success: true, stats, recent,
      lessons: lessons.map(({ row, ...l }) => { void row; return l; }).reverse(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/**
 * { action: "propose" }: AI turns recurring corrections into lessons waiting for approval.
 * { action: "review", id, status, text?, target? }: approve, edit or drop a lesson.
 * Both change what later prompts say, so they need the manage_lessons capability.
 */
export async function POST(req: NextRequest) {
  const denied = await requireCapability("manage_lessons");
  if (denied) return denied;
  const session = await getServerSession(authOptions).catch(() => null);
  try {
    const body = await req.json();
    if (body?.action === "propose") {
      if (!process.env.OPENAI_API_KEY) return NextResponse.json({ success: false, error: "Thiếu OPENAI_API_KEY." }, { status: 500 });
      return NextResponse.json({ success: true, ...(await proposeLessons()) });
    }
    if (body?.action === "review") {
      if (typeof body.id !== "string" || !isLessonStatus(body.status)) {
        return NextResponse.json({ success: false, error: "Thiếu id hoặc trạng thái không hợp lệ." }, { status: 400 });
      }
      if (body.target !== undefined && !isLessonTarget(body.target)) {
        return NextResponse.json({ success: false, error: "Bước áp dụng không hợp lệ." }, { status: 400 });
      }
      const lesson = await reviewLesson(body.id, {
        status: body.status,
        ...(typeof body.text === "string" && { text: body.text }),
        ...(body.target !== undefined && { target: body.target }),
      }, session?.user?.email || session?.user?.name || "");
      return NextResponse.json({ success: true, lesson });
    }
    return NextResponse.json({ success: false, error: "action phải là propose hoặc review." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
